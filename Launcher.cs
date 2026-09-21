using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;

class TexasHoldemLauncher {
    static Process serverProcess = null;

    static void Main(string[] args) {
        Console.OutputEncoding = Encoding.UTF8;
        Console.Title = "德州扑克 (Texas Hold'em) - 局域网联机服务端";

        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        string serverJs = Path.Combine(baseDir, "server.js");

        if (!File.Exists(serverJs)) {
            Console.ForegroundColor = ConsoleColor.Red;
            Console.WriteLine("错误: 未找到 server.js 文件！请确保本程序位于德州扑克游戏根目录。");
            Console.ResetColor();
            Console.WriteLine("\n按回车键退出...");
            Console.ReadLine();
            return;
        }

        string nodeExe = FindNodeExecutable();
        if (string.IsNullOrEmpty(nodeExe)) {
            Console.ForegroundColor = ConsoleColor.Red;
            Console.WriteLine("================================================================");
            Console.WriteLine("  未检测到 Node.js 环境！");
            Console.WriteLine("================================================================");
            Console.ResetColor();
            Console.WriteLine("本联机版德州扑克需要 Node.js 运行环境。");
            Console.WriteLine("请前往官方网站下载安装 (推荐 LTS 版本):");
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine("  https://nodejs.org/");
            Console.ResetColor();
            Console.WriteLine("\n按回车键自动打开 Node.js 官网下载页面...");
            Console.ReadLine();
            try {
                Process.Start(new ProcessStartInfo("https://nodejs.org/") { UseShellExecute = true });
            } catch { }
            return;
        }

        // 自动检测并补齐 node_modules 依赖 (首次克隆/下载时)
        string nodeModulesDir = Path.Combine(baseDir, "node_modules");
        string wsDir = Path.Combine(nodeModulesDir, "ws");
        if (!Directory.Exists(nodeModulesDir) || !Directory.Exists(wsDir)) {
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine("================================================================");
            Console.WriteLine("  首次运行检测：正在自动安装项目必要依赖 (npm install)...");
            Console.WriteLine("================================================================");
            Console.ResetColor();
            try {
                ProcessStartInfo npmPsi = new ProcessStartInfo {
                    FileName = "cmd.exe",
                    Arguments = "/c npm install",
                    WorkingDirectory = baseDir,
                    UseShellExecute = false
                };
                Process npmProcess = Process.Start(npmPsi);
                if (npmProcess != null) npmProcess.WaitForExit();
                Console.ForegroundColor = ConsoleColor.Green;
                Console.WriteLine("✅ 依赖安装成功！\n");
                Console.ResetColor();
            } catch (Exception ex) {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine("⚠️ 自动安装依赖失败: " + ex.Message + "，请手动在终端执行 npm install。");
                Console.ResetColor();
            }
        }

        Console.ForegroundColor = ConsoleColor.Yellow;
        Console.WriteLine("================================================================");
        Console.WriteLine("  ♠ 德州扑克 (Texas Hold'em) - 局域网联机服务端 ♠");
        Console.WriteLine("================================================================");
        Console.ResetColor();
        Console.WriteLine("正在启动服务并准备就绪...\n");

        // 注册退出信号处理
        AppDomain.CurrentDomain.ProcessExit += (s, e) => KillServerProcess();
        Console.CancelKeyPress += (s, e) => {
            KillServerProcess();
            e.Cancel = true;
        };

        try {
            ProcessStartInfo psi = new ProcessStartInfo {
                FileName = nodeExe,
                Arguments = "\"" + serverJs + "\"",
                WorkingDirectory = baseDir,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8
            };

            serverProcess = new Process { StartInfo = psi };

            bool browserOpened = false;
            object lockObj = new object();

            serverProcess.OutputDataReceived += (sender, e) => {
                if (e.Data != null) {
                    Console.WriteLine(e.Data);

                    // 检测到服务器就绪输出后自动唤起浏览器
                    if (!browserOpened && (e.Data.Contains("http://localhost") || e.Data.Contains("德州扑克局域网对战联机服务器已启动"))) {
                        lock (lockObj) {
                            if (!browserOpened) {
                                browserOpened = true;
                                OpenBrowser("http://localhost:3000");
                            }
                        }
                    }
                }
            };

            serverProcess.ErrorDataReceived += (sender, e) => {
                if (!string.IsNullOrEmpty(e.Data)) {
                    Console.ForegroundColor = ConsoleColor.Red;
                    Console.WriteLine("[服务端日志] " + e.Data);
                    Console.ResetColor();
                }
            };

            serverProcess.Start();
            serverProcess.BeginOutputReadLine();
            serverProcess.BeginErrorReadLine();

            // 超时保底打开浏览器 (以防未截获到特定关键字)
            Thread bgCheck = new Thread(() => {
                Thread.Sleep(1500);
                lock (lockObj) {
                    if (!browserOpened) {
                        browserOpened = true;
                        OpenBrowser("http://localhost:3000");
                    }
                }
            });
            bgCheck.IsBackground = true;
            bgCheck.Start();

            Console.ForegroundColor = ConsoleColor.Green;
            Console.WriteLine("提示: 默认浏览器将在几秒内自动打开游戏界面。");
            Console.WriteLine("按键盘 [Q] 键或直接关闭本窗口可随时退出服务端。\n");
            Console.ResetColor();

            // 监听按键等待用户退出
            while (!serverProcess.HasExited) {
                if (Console.KeyAvailable) {
                    ConsoleKeyInfo key = Console.ReadKey(true);
                    if (key.Key == ConsoleKey.Q || key.Key == ConsoleKey.Escape) {
                        Console.WriteLine("\n正在安全关闭服务端...");
                        break;
                    }
                }
                Thread.Sleep(200);
            }
        } catch (Exception ex) {
            Console.ForegroundColor = ConsoleColor.Red;
            Console.WriteLine("启动发生异常: " + ex.Message);
            Console.ResetColor();
        } finally {
            KillServerProcess();
        }
    }

    static void OpenBrowser(string url) {
        try {
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        } catch {
            try {
                Process.Start("cmd.exe", "/c start " + url);
            } catch { }
        }
    }

    static void KillServerProcess() {
        if (serverProcess != null && !serverProcess.HasExited) {
            try {
                // 杀死 node 进程树
                ProcessStartInfo killPsi = new ProcessStartInfo {
                    FileName = "taskkill",
                    Arguments = "/PID " + serverProcess.Id + " /T /F",
                    CreateNoWindow = true,
                    UseShellExecute = false
                };
                Process kp = Process.Start(killPsi);
                if (kp != null) kp.WaitForExit(1000);
            } catch {
                try { serverProcess.Kill(); } catch { }
            }
            serverProcess = null;
        }
    }

    static string FindNodeExecutable() {
        // 1. 尝试直接从系统 PATH 中探测
        try {
            Process p = new Process {
                StartInfo = new ProcessStartInfo {
                    FileName = "where",
                    Arguments = "node",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    CreateNoWindow = true
                }
            };
            p.Start();
            string output = p.StandardOutput.ReadToEnd();
            p.WaitForExit();
            if (p.ExitCode == 0 && !string.IsNullOrWhiteSpace(output)) {
                string[] lines = output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
                if (lines.Length > 0 && File.Exists(lines[0].Trim())) {
                    return lines[0].Trim();
                }
            }
        } catch { }

        // 2. 尝试几个常见的默认安装路径
        string[] candidates = new string[] {
            @"C:\Program Files\nodejs\node.exe",
            @"C:\Program Files (x86)\nodejs\node.exe",
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\node\node.exe")
        };

        foreach (string path in candidates) {
            if (File.Exists(path)) return path;
        }

        return null;
    }
}
