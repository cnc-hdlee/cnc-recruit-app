using System;
using System.Diagnostics;
using System.IO;
using System.Text;

class SevenZaWrapper {
    static string EscapeArg(string a) {
        if (a.Length == 0) return "\"\"";
        if (a.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return a;
        var sb = new StringBuilder();
        sb.Append('"');
        int backslashes = 0;
        foreach (var c in a) {
            if (c == '\\') { backslashes++; }
            else if (c == '"') {
                sb.Append('\\', backslashes * 2 + 1);
                sb.Append('"');
                backslashes = 0;
            } else {
                if (backslashes > 0) { sb.Append('\\', backslashes); backslashes = 0; }
                sb.Append(c);
            }
        }
        sb.Append('\\', backslashes * 2);
        sb.Append('"');
        return sb.ToString();
    }

    static int Main(string[] args) {
        var dir = Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location);
        var realPath = Path.Combine(dir, "7za-real.exe");
        var sb = new StringBuilder();
        for (int i = 0; i < args.Length; i++) {
            if (i > 0) sb.Append(' ');
            sb.Append(EscapeArg(args[i]));
        }
        var psi = new ProcessStartInfo();
        psi.FileName = realPath;
        psi.Arguments = sb.ToString();
        psi.UseShellExecute = false;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        var p = Process.Start(psi);
        p.OutputDataReceived += delegate(object s, DataReceivedEventArgs e) {
            if (e.Data != null) Console.WriteLine(e.Data);
        };
        p.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e) {
            if (e.Data != null) Console.Error.WriteLine(e.Data);
        };
        p.BeginOutputReadLine();
        p.BeginErrorReadLine();
        p.WaitForExit();
        int code = p.ExitCode;
        if (code == 1 || code == 2) return 0;
        return code;
    }
}
