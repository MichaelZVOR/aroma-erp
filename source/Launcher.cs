using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;
using System.Management;

public static class Launcher {
 const string Url="http://127.0.0.1:8788";
 static string Root=AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
 static JavaScriptSerializer Json=new JavaScriptSerializer{MaxJsonLength=32*1024*1024};
 static Dictionary<string,object> Get(string path) {
  var req=(HttpWebRequest)WebRequest.Create(Url+path);req.Proxy=null;req.Timeout=1800;req.ReadWriteTimeout=1800;
  using(var response=req.GetResponse())using(var reader=new StreamReader(response.GetResponseStream(),Encoding.UTF8))return Json.Deserialize<Dictionary<string,object>>(reader.ReadToEnd());
 }
 static Dictionary<string,object> Health(){try{return Get("/api/health");}catch{return null;}}
 static string Hash(){using(var h=SHA256.Create()){foreach(var name in new[]{"server.py","static/index.html","static/app.js","static/style.css","seed.json"}){var b=File.ReadAllBytes(Path.Combine(Root,name));h.TransformBlock(b,0,b.Length,b,0);}h.TransformFinalBlock(new byte[0],0,0);return BitConverter.ToString(h.Hash).Replace("-","").ToLowerInvariant();}}
 static string Python(){
  foreach(var hive in new[]{Registry.CurrentUser,Registry.LocalMachine})foreach(var baseKey in new[]{"SOFTWARE\\Python\\PythonCore","SOFTWARE\\WOW6432Node\\Python\\PythonCore"}){
   using(var root=hive.OpenSubKey(baseKey)){if(root==null)continue;foreach(var v in root.GetSubKeyNames().OrderByDescending(x=>x)){Version ver;if(!Version.TryParse(v.Split('-')[0],out ver)||ver<new Version(3,10))continue;using(var key=root.OpenSubKey(v+"\\InstallPath")){if(key==null)continue;var executable=key.GetValue("ExecutablePath") as string;var folder=key.GetValue("") as string;if(executable!=null&&File.Exists(executable))return executable;if(folder!=null&&File.Exists(Path.Combine(folder,"python.exe")))return Path.Combine(folder,"python.exe");}}}
  }
  var bundled=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),".cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe");
  if(File.Exists(bundled))return bundled;
  throw new Exception("Не найден Python 3.10 или новее. Обратитесь в чат, где создавалась программа: установим подходящий запуск.");
 }
 static void Stop(Dictionary<string,object> health){
  object root;if(!health.TryGetValue("root",out root)||!String.Equals(Convert.ToString(root).Replace('/','\\').TrimEnd('\\'),Root,StringComparison.OrdinalIgnoreCase))throw new Exception("Адрес занят другой копией программы. Автоматическая остановка отменена, чтобы сохранить чужие данные.");
  var state=Get("/api/state");var request=(HttpWebRequest)WebRequest.Create(Url+"/api/stop");request.Proxy=null;request.Method="POST";request.ContentType="application/json";request.Headers["X-Aroma-Token"]=Convert.ToString(state["token"]);request.Timeout=5000;var body=Encoding.UTF8.GetBytes("{}");request.ContentLength=body.Length;using(var stream=request.GetRequestStream())stream.Write(body,0,body.Length);using(var response=request.GetResponse()){}
  for(int i=0;i<50;i++){if(Health()==null)return;Thread.Sleep(100);}throw new Exception("Сервер не завершил работу. Данные сохранены; повторите запуск немного позже.");
 }
 static bool RetailReady(){try{var req=(HttpWebRequest)WebRequest.Create("http://127.0.0.1:8791/login");req.Proxy=null;req.Timeout=1200;using(var res=req.GetResponse())return ((HttpWebResponse)res).StatusCode==HttpStatusCode.OK;}catch{return false;}}
 static void StartRetail(){
  var folder=Path.Combine(Root,"next-retail");
  var node=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),".cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\bin\\node.exe");
  var build=File.ReadAllText(Path.Combine(folder,".next","BUILD_ID")).Trim();
  var marker=Path.Combine(folder,"data","running-build.txt");
  if(RetailReady()){
   if(File.Exists(marker)&&File.ReadAllText(marker).Trim()==build)return;
   bool stopped=false;
   using(var search=new ManagementObjectSearcher("SELECT ProcessId,ExecutablePath,CommandLine FROM Win32_Process WHERE Name='node.exe'"))foreach(ManagementObject item in search.Get()){
    var command=Convert.ToString(item["CommandLine"]);var executable=Convert.ToString(item["ExecutablePath"]);
    if(!String.Equals(executable,node,StringComparison.OrdinalIgnoreCase)||command.IndexOf(Path.Combine(folder,"server.js"),StringComparison.OrdinalIgnoreCase)<0)continue;
    var owned=Process.GetProcessById(Convert.ToInt32(item["ProcessId"]));
    if(owned.SessionId!=Process.GetCurrentProcess().SessionId)continue;
    owned.Kill();owned.WaitForExit(5000);stopped=true;
   }
   if(!stopped)throw new Exception("Адрес склада занят другой программой. Автоматическая остановка отменена.");
  }
  if(!File.Exists(node)||!File.Exists(Path.Combine(folder,"server.js")))throw new Exception("Не найдены файлы нового склада.");
  var info=new ProcessStartInfo{FileName=node,Arguments="\""+Path.Combine(folder,"server.js")+"\"",WorkingDirectory=folder,UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden};
  info.EnvironmentVariables["PORT"]="8791";info.EnvironmentVariables["HOSTNAME"]="127.0.0.1";
  var process=Process.Start(info);
  for(var i=0;i<40;i++){if(RetailReady()){File.WriteAllText(marker,build);File.WriteAllText(Path.Combine(folder,"data","server-pid.txt"),process.Id.ToString());return;}if(process.HasExited)throw new Exception("Склад завершился при запуске, код "+process.ExitCode);Thread.Sleep(250);}
  throw new Exception("Новый склад не ответил. Прежние данные сохранены.");
 }
 [STAThread] public static int Main(){Application.EnableVisualStyles();try{
  bool owned;using(var mutex=new Mutex(true,"Local\\Aroma-8788-Launcher",out owned)){
   if(!owned)return 0;
   string hash=Hash();var health=Health();
   if(health!=null){object value;if(!health.TryGetValue("app",out value)||Convert.ToString(value)!="aroma")throw new Exception("Адрес программы занят другим приложением.");if(Convert.ToString(health["signature"])!=hash){Stop(health);health=null;}else if(!String.Equals(Convert.ToString(health["root"]).Replace('/','\\').TrimEnd('\\'),Root,StringComparison.OrdinalIgnoreCase))throw new Exception("На этом адресе открыта другая рабочая папка Аромы.");}
   if(health==null){var start=new ProcessStartInfo{FileName=Python(),Arguments="\""+Path.Combine(Root,"server.py")+"\" --no-browser",WorkingDirectory=Root,UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden};start.EnvironmentVariables["AROMA_DATA_DIR"]=Path.Combine(Root,"data");start.EnvironmentVariables["AROMA_PORT"]="8788";var process=Process.Start(start);for(int i=0;i<100;i++){health=Health();if(health!=null)break;if(process.HasExited)throw new Exception("Сервер завершился при запуске (код "+process.ExitCode+"). Проверьте файлы программы в "+Root);Thread.Sleep(150);}if(health==null)throw new Exception("Сервер не ответил. Проверьте доступ к папке "+Root);if(Convert.ToString(health["signature"])!=hash)throw new Exception("Открылся сервер другой версии. Данные не изменены.");}
   StartRetail();Process.Start(new ProcessStartInfo(Url){UseShellExecute=true});return 0;
  }
 }catch(Exception e){try{Directory.CreateDirectory(Path.Combine(Root,"data"));File.WriteAllText(Path.Combine(Root,"data","launch-error.txt"),DateTime.Now+"\r\n"+e,Encoding.UTF8);}catch{}MessageBox.Show(e.Message,"Арома — запуск",MessageBoxButtons.OK,MessageBoxIcon.Error);return 1;}}
}
