using System;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Globalization;

class Mach3Bridge
{
    const string PORT = "8765";

    static dynamic mach = null;
    static dynamic scripter = null;
    static bool isMachConnected = false;
    static readonly object lockObj = new object();

    static bool valveOpen = false;
    static List<int> loweredDispensers = new List<int>();
    static int activeDispenserId = 1;
    static int totalLines = 0;
    static string valveOpenCmd = "M11 P1";
    static string valveCloseCmd = "M10 P1";
    static Dictionary<int, string> dispenserLowerCmds = new Dictionary<int, string>();
    static Dictionary<int, string> dispenserRaiseCmds = new Dictionary<int, string>();

    static bool EnsureMach3()
    {
        lock (lockObj)
        {
            if (Process.GetProcessesByName("Mach3").Length == 0)
            {
                if (isMachConnected)
                {
                    LogWarning("[MACH3] Mach3 е исклучен.");
                    isMachConnected = false;
                    mach = null;
                    scripter = null;
                }
                return false;
            }

            if (isMachConnected && scripter != null) return true;

            try
            {
                object activeObj = Marshal.GetActiveObject("Mach4.Document");
                mach = activeObj;
                scripter = mach.GetScriptDispatch();
                
                // Проверка само на X оска
                double x = Convert.ToDouble(scripter.GetDRO(0));

                isMachConnected = true;
                LogSuccess("[MACH3] УСПЕШНО ПОВРЗАН СО ВАШИОТ DRIVER-MACH3.JS!");
                return true;
            }
            catch
            {
                isMachConnected = false;
                mach = null;
                scripter = null;
                return false;
            }
        }
    }

    // 100% БЕЗБЕДНО КРЕИРАЊЕ НА SNAPSHOT
    static string BuildSnapshotJson(string errorMsg = null)
    {
        lock (lockObj)
        {
            double x = 0, y = 0, feed = 0;
            int lineNum = 0;
            bool isMoving = false;
            bool isReset = false;
            string status = "DISCONNECTED";

            if (isMachConnected && scripter != null)
            {
                // Читај го секој параметар поединечно за да не падне целата функција
                try { x = Convert.ToDouble(scripter.GetDRO(0)); } catch { }
                try { y = Convert.ToDouble(scripter.GetDRO(1)); } catch { }
                try { feed = Convert.ToDouble(scripter.GetOEMDRO(818)); } catch { }
                try { lineNum = Convert.ToInt32(scripter.GetOEMDRO(816)); } catch { }
                
                try 
                { 
                    // Mach3 враќа -1 за true, 0 за false
                    isMoving = Convert.ToInt32(scripter.IsMoving()) != 0; 
                } 
                catch { }

                try 
                { 
                    isReset = Convert.ToInt32(scripter.GetOEMLED(800)) != 0; 
                } 
                catch { }

                if (isReset) status = "ESTOP";
                else if (isMoving) status = "RUNNING";
                else status = "IDLE";
            }

            string loweredJson = "[" + string.Join(",", loweredDispensers.ToArray()) + "]";
            string errStr = string.IsNullOrEmpty(errorMsg) ? "null" : "\"" + errorMsg.Replace("\"", "\\\"") + "\"";

            return string.Format(
                CultureInfo.InvariantCulture,
                "{{\"status\":\"{0}\",\"mach3Connected\":{1},\"x\":{2:F3},\"y\":{3:F3},\"feedrate\":{4:F0},\"lineNum\":{5},\"totalLines\":{6},\"valveOpen\":{7},\"loweredDispensers\":{8},\"activeDispenserId\":{9},\"error\":{10}}}",
                status,
                isMachConnected ? "true" : "false",
                x, y, feed, lineNum, totalLines,
                valveOpen ? "true" : "false",
                loweredJson,
                activeDispenserId,
                errStr
            );
        }
    }

    static void Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;
        Console.Title = "Mach3 Driver Bridge (Port: " + PORT + ")";

        AppDomain.CurrentDomain.UnhandledException += (s, e) =>
        {
            LogError("\n[ГРЕШКА]: " + e.ExceptionObject.ToString());
            Console.ReadLine();
        };

        Console.ForegroundColor = ConsoleColor.Cyan;
        Console.WriteLine("===============================================================");
        Console.WriteLine("           MACH3 ПОСВЕТЕН МОСТ ЗА CNC УРЕДУВАЧОТ               ");
        Console.WriteLine("===============================================================");
        Console.ResetColor();

        EnsureMach3();

        HttpListener listener = new HttpListener();
        listener.Prefixes.Add("http://127.0.0.1:" + PORT + "/");
        listener.Prefixes.Add("http://localhost:" + PORT + "/");

        try
        {
            listener.Start();
            LogSuccess("[МРЕЖА] Бриџот слуша на: http://127.0.0.1:" + PORT + "/");
            Console.WriteLine("---------------------------------------------------------------\n");
        }
        catch (Exception ex)
        {
            LogError("[ГРЕШКА] Портата е зафатена: " + ex.Message);
            Console.ReadLine();
            return;
        }

        while (true)
        {
            try
            {
                HttpListenerContext context = listener.GetContext();
                ProcessRequest(context);
            }
            catch { }
        }
    }

    static void ProcessRequest(HttpListenerContext context)
    {
        HttpListenerRequest req = context.Request;
        HttpListenerResponse res = context.Response;

        try
        {
            res.AddHeader("Access-Control-Allow-Origin", "*");
            res.AddHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
            res.AddHeader("Access-Control-Allow-Headers", "Content-Type, Origin, Accept");
            res.AddHeader("Access-Control-Allow-Private-Network", "true");

            if (req.HttpMethod == "OPTIONS")
            {
                res.StatusCode = 200;
                res.Close();
                return;
            }

            string rawUrl = req.Url.AbsolutePath.ToLower();
            string time = DateTime.Now.ToString("HH:mm:ss");

            EnsureMach3();

            string body = "";
            if (req.HasEntityBody)
            {
                using (var reader = new StreamReader(req.InputStream, req.ContentEncoding))
                {
                    body = reader.ReadToEnd();
                }
            }

            // 1. GET /status (или /api/mach3-bridge/status)
            if (rawUrl.EndsWith("/status") && req.HttpMethod == "GET")
            {
                SendJson(res, BuildSnapshotJson());
                return;
            }

            // 2. POST /config
            if (rawUrl.EndsWith("/config") && req.HttpMethod == "POST")
            {
                Console.WriteLine("[" + time + "] [CONFIG] Синхронизација со апликацијата.");
                Match mOpen = Regex.Match(body, "\"valveOpenCmd\"\\s*:\\s*\"([^\"]+)\"");
                if (mOpen.Success) valveOpenCmd = mOpen.Groups[1].Value.ToUpper().Trim();
                Match mClose = Regex.Match(body, "\"valveCloseCmd\"\\s*:\\s*\"([^\"]+)\"");
                if (mClose.Success) valveCloseCmd = mClose.Groups[1].Value.ToUpper().Trim();

                MatchCollection mDisps = Regex.Matches(body, "{\"id\"\\s*:\\s*(\\d+)[^}]*\"lowerCmd\"\\s*:\\s*\"([^\"]+)\"[^}]*\"raiseCmd\"\\s*:\\s*\"([^\"]+)\"}");
                foreach (Match md in mDisps)
                {
                    int dId = int.Parse(md.Groups[1].Value);
                    dispenserLowerCmds[dId] = md.Groups[2].Value.ToUpper().Trim();
                    dispenserRaiseCmds[dId] = md.Groups[3].Value.ToUpper().Trim();
                }

                SendJson(res, BuildSnapshotJson());
                return;
            }

            // 3. POST /load_and_run
            if (rawUrl.EndsWith("/load_and_run") && req.HttpMethod == "POST")
            {
                Console.WriteLine("[" + time + "] [LOAD_AND_RUN] Стартување на G-код!");
                Match mGcode = Regex.Match(body, "\"gcode\"\\s*:\\s*\"([\\s\\S]*?)(?<!\\\\)\"");
                string gcode = mGcode.Success ? Regex.Unescape(mGcode.Groups[1].Value) : "";

                Match mOpen = Regex.Match(body, "\"valveOpenCmd\"\\s*:\\s*\"([^\"]+)\"");
                if (mOpen.Success) valveOpenCmd = mOpen.Groups[1].Value.ToUpper().Trim();
                Match mClose = Regex.Match(body, "\"valveCloseCmd\"\\s*:\\s*\"([^\"]+)\"");
                if (mClose.Success) valveCloseCmd = mClose.Groups[1].Value.ToUpper().Trim();

                if (isMachConnected && scripter != null && !string.IsNullOrEmpty(gcode))
                {
                    string tempFile = Path.Combine(Path.GetTempPath(), "active_job.tap");
                    File.WriteAllText(tempFile, gcode);
                    totalLines = gcode.Split('\n').Length;

                    lock (lockObj)
                    {
                        scripter.LoadFile(tempFile);
                        int maxWaitMs = 15000;
                        int waited = 0;
                        while (Convert.ToInt32(scripter.IsLoading()) != 0 && waited < maxWaitMs)
                        {
                            System.Threading.Thread.Sleep(50);
                            waited += 50;
                        }
                        System.Threading.Thread.Sleep(100);
                        scripter.DoOEMButton(1000); // Cycle Start
                    }
                }
                SendJson(res, BuildSnapshotJson());
                return;
            }

            // 4. КОНТРОЛИ: /pause, /resume, /stop, /reset
            if (rawUrl.EndsWith("/pause") && req.HttpMethod == "POST")
            {
                Console.WriteLine("[" + time + "] [ACTION] PAUSE");
                lock (lockObj) { if (isMachConnected && scripter != null) scripter.DoOEMButton(1001); }
                SendJson(res, BuildSnapshotJson());
                return;
            }
            if (rawUrl.EndsWith("/resume") && req.HttpMethod == "POST")
            {
                Console.WriteLine("[" + time + "] [ACTION] RESUME");
                lock (lockObj) { if (isMachConnected && scripter != null) scripter.DoOEMButton(1000); }
                SendJson(res, BuildSnapshotJson());
                return;
            }
            if (rawUrl.EndsWith("/stop") && req.HttpMethod == "POST")
            {
                Console.WriteLine("[" + time + "] [ACTION] STOP");
                lock (lockObj)
                {
                    if (isMachConnected && scripter != null) scripter.DoOEMButton(1003);
                    valveOpen = false;
                    loweredDispensers.Clear();
                }
                SendJson(res, BuildSnapshotJson());
                return;
            }
            if (rawUrl.EndsWith("/reset") && req.HttpMethod == "POST")
            {
                Console.WriteLine("[" + time + "] [ACTION] RESET");
                lock (lockObj)
                {
                    if (isMachConnected && scripter != null) scripter.DoOEMButton(1021);
                    valveOpen = false;
                    loweredDispensers.Clear();
                }
                SendJson(res, BuildSnapshotJson());
                return;
            }

            // 5. POST /jog
            if (rawUrl.EndsWith("/jog") && req.HttpMethod == "POST")
            {
                Match mAxis = Regex.Match(body, "\"axis\"\\s*:\\s*\"([^\"]+)\"");
                Match mStep = Regex.Match(body, "\"step\"\\s*:\\s*([-0-9.]+)");
                if (mAxis.Success && mStep.Success)
                {
                    string axis = mAxis.Groups[1].Value.ToUpper();
                    double step = double.Parse(mStep.Groups[1].Value, CultureInfo.InvariantCulture);
                    string jogGCode = string.Format(CultureInfo.InvariantCulture, "G91 G0 {0}{1:F3} G90", axis, step);
                    Console.WriteLine("[" + time + "] [JOG] " + jogGCode);

                    lock (lockObj) { if (isMachConnected && scripter != null) scripter.Code(jogGCode); }
                }
                SendJson(res, BuildSnapshotJson());
                return;
            }

            // 6. POST /zero
            if (rawUrl.EndsWith("/zero") && req.HttpMethod == "POST")
            {
                Match mAxis = Regex.Match(body, "\"axis\"\\s*:\\s*\"([^\"]+)\"");
                if (mAxis.Success)
                {
                    string axis = mAxis.Groups[1].Value.ToUpper();
                    Console.WriteLine("[" + time + "] [ZERO] Нулирање на оска " + axis);
                    lock (lockObj)
                    {
                        if (isMachConnected && scripter != null)
                        {
                            if (axis == "X") scripter.DoOEMButton(1007);
                            else if (axis == "Y") scripter.DoOEMButton(1008);
                            else if (axis == "Z") scripter.DoOEMButton(1009);
                        }
                    }
                }
                SendJson(res, BuildSnapshotJson());
                return;
            }

            // 7. POST /mdi
            if (rawUrl.EndsWith("/mdi") && req.HttpMethod == "POST")
            {
                Match mCmd = Regex.Match(body, "\"cmd\"\\s*:\\s*\"([^\"]+)\"");
                if (mCmd.Success)
                {
                    string cmd = mCmd.Groups[1].Value;
                    Console.WriteLine("[" + time + "] [MDI] " + cmd);

                    lock (lockObj)
                    {
                        if (cmd == "RAISE_ALL")
                        {
                            MatchCollection mRaises = Regex.Matches(body, "\"raiseCmds\"\\s*:\\s*\\[([^\\]]+)\\]");
                            if (mRaises.Count > 0)
                            {
                                string inside = mRaises[0].Groups[1].Value;
                                foreach (Match sub in Regex.Matches(inside, "\"([^\"]+)\""))
                                {
                                    if (isMachConnected && scripter != null) scripter.Code(sub.Groups[1].Value);
                                }
                            }
                            loweredDispensers.Clear();
                        }
                        else if (cmd.StartsWith("PULSE:"))
                        {
                            int duration = 100;
                            int.TryParse(cmd.Substring(6), out duration);
                            if (duration <= 0) duration = 100;

                            bool isM11 = valveOpenCmd.Contains("M11");
                            if (isMachConnected && scripter != null)
                            {
                                if (isM11)
                                {
                                    scripter.Code(valveOpenCmd);
                                    scripter.Code("G91 G1 X0.001 F200 G90");
                                    System.Threading.Thread.Sleep(duration);
                                    scripter.Code(valveCloseCmd);
                                    scripter.Code("G91 G1 X-0.001 F200 G90");
                                }
                                else
                                {
                                    scripter.Code(valveOpenCmd);
                                    System.Threading.Thread.Sleep(duration);
                                    scripter.Code(valveCloseCmd);
                                }
                            }
                            valveOpen = false;
                        }
                        else
                        {
                            string[] lines = cmd.Split(new char[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
                            foreach (string line in lines)
                            {
                                string trimmed = line.Trim();
                                if (!string.IsNullOrEmpty(trimmed) && isMachConnected && scripter != null)
                                {
                                    scripter.Code(trimmed);
                                }
                            }

                            string upper = cmd.ToUpper().Trim();
                            if (!string.IsNullOrEmpty(valveOpenCmd) && upper.Contains(valveOpenCmd)) valveOpen = true;
                            if (!string.IsNullOrEmpty(valveCloseCmd) && upper.Contains(valveCloseCmd)) valveOpen = false;

                            foreach (KeyValuePair<int, string> kvp in dispenserLowerCmds)
                            {
                                if (!string.IsNullOrEmpty(kvp.Value) && upper.Contains(kvp.Value))
                                {
                                    if (!loweredDispensers.Contains(kvp.Key)) loweredDispensers.Add(kvp.Key);
                                }
                            }
                            foreach (KeyValuePair<int, string> kvp in dispenserRaiseCmds)
                            {
                                if (!string.IsNullOrEmpty(kvp.Value) && upper.Contains(kvp.Value))
                                {
                                    loweredDispensers.Remove(kvp.Key);
                                }
                            }
                        }
                    }
                }
                SendJson(res, BuildSnapshotJson());
                return;
            }

            // 8. Сервисирање датотеки (index.html, js, css)
            string filename = rawUrl == "/" ? "index.html" : rawUrl.TrimStart('/');
            string localFilePath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, filename);

            if (File.Exists(localFilePath))
            {
                byte[] fileBytes = File.ReadAllBytes(localFilePath);
                string contentType = "application/octet-stream";
                if (localFilePath.EndsWith(".html")) contentType = "text/html; charset=utf-8";
                else if (localFilePath.EndsWith(".js")) contentType = "application/javascript";
                else if (localFilePath.EndsWith(".css")) contentType = "text/css";

                res.ContentType = contentType;
                res.ContentLength64 = fileBytes.Length;
                res.OutputStream.Write(fileBytes, 0, fileBytes.Length);
                res.OutputStream.Close();
                return;
            }

            SendJson(res, BuildSnapshotJson());
        }
        catch
        {
            try { res.Close(); } catch { }
        }
    }

    static void SendJson(HttpListenerResponse res, string json)
    {
        byte[] buffer = Encoding.UTF8.GetBytes(json);
        res.ContentType = "application/json; charset=utf-8";
        res.ContentLength64 = buffer.Length;
        res.OutputStream.Write(buffer, 0, buffer.Length);
        res.OutputStream.Close();
    }

    static void LogSuccess(string msg) { Console.ForegroundColor = ConsoleColor.Green; Console.WriteLine(msg); Console.ResetColor(); }
    static void LogWarning(string msg) { Console.ForegroundColor = ConsoleColor.Yellow; Console.WriteLine(msg); Console.ResetColor(); }
    static void LogError(string msg) { Console.ForegroundColor = ConsoleColor.Red; Console.WriteLine(msg); Console.ResetColor(); }
}