import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import server

class FreshInstallTests(unittest.TestCase):
    def test_empty_install_and_reinitialization_preserve_database(self):
        with tempfile.TemporaryDirectory() as folder:
            previous = server.DATA, server.DB
            try:
                server.DATA = Path(folder)
                server.DB = server.DATA / 'aroma.sqlite3'
                server.init()
                self.assertEqual(server.state()['products'], [])
                with server.connect() as c:
                    c.execute("INSERT INTO products(id,code,name,kind) VALUES(?,?,?,?)", ('test', 'TEST', 'Тестовый товар', 'bottle'))
                server.init()
                self.assertEqual(len(server.state()['products']), 1)
                with server.connect() as c:
                    self.assertEqual(c.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
                    self.assertEqual(c.execute('PRAGMA foreign_key_check').fetchall(), [])
            finally:
                server.DATA, server.DB = previous

if __name__ == '__main__':
    unittest.main()
