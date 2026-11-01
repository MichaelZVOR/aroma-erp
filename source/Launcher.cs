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
 [STAThread] public static int Main(){Application.EnableVisualStyles();try{
  bool owned;using(var mutex=new Mutex(true,"Local\\Aroma-8788-Launcher",out owned)){
   if(!owned)return 0;
   string hash=Hash();var health=Health();
   if(health!=null){object value;if(!health.TryGetValue("app",out value)||Convert.ToString(value)!="aroma")throw new Exception("Адрес программы занят другим приложением.");if(Convert.ToString(health["signature"])!=hash){Stop(health);health=null;}else if(!String.Equals(Convert.ToString(health["root"]).Replace('/','\\').TrimEnd('\\'),Root,StringComparison.OrdinalIgnoreCase))throw new Exception("На этом адресе открыта другая рабочая папка Аромы.");}
   if(health==null){var start=new ProcessStartInfo{FileName=Python(),Arguments="\""+Path.Combine(Root,"server.py")+"\" --no-browser",WorkingDirectory=Root,UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden};start.EnvironmentVariables["AROMA_DATA_DIR"]=Path.Combine(Root,"data");start.EnvironmentVariables["AROMA_PORT"]="8788";var process=Process.Start(start);for(int i=0;i<100;i++){health=Health();if(health!=null)break;if(process.HasExited)throw new Exception("Сервер завершился при запуске (код "+process.ExitCode+"). Проверьте файлы программы в "+Root);Thread.Sleep(150);}if(health==null)throw new Exception("Сервер не ответил. Проверьте доступ к папке "+Root);if(Convert.ToString(health["signature"])!=hash)throw new Exception("Открылся сервер другой версии. Данные не изменены.");}
   Process.Start(new ProcessStartInfo(Url){UseShellExecute=true});return 0;
  }
 }catch(Exception e){try{Directory.CreateDirectory(Path.Combine(Root,"data"));File.WriteAllText(Path.Combine(Root,"data","launch-error.txt"),DateTime.Now+"\r\n"+e,Encoding.UTF8);}catch{}MessageBox.Show(e.Message,"Арома — запуск",MessageBoxButtons.OK,MessageBoxIcon.Error);return 1;}}
}
