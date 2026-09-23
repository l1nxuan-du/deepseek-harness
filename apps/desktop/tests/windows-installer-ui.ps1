Add-Type -AssemblyName System.Drawing
if (-not ('InstallerCapture' -as [type])) {
    Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;

public static class InstallerCapture {
    public static string ProductName;
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    public static void Initialize() { SetProcessDPIAware(); }
    public delegate bool WindowCallback(IntPtr window, IntPtr data);
    [DllImport("user32.dll")] static extern bool EnumWindows(WindowCallback callback, IntPtr data);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, WindowCallback callback, IntPtr data);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder text, int count);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] static extern bool RedrawWindow(IntPtr window, IntPtr rect, IntPtr region, uint flags);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window, uint flags);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr window, int index);
    [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr window, int id);
    [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr window);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left, Top, Right, Bottom; }

    public static string Bounds(IntPtr window) {
        Rect rect;
        if (!GetWindowRect(window, out rect)) throw new InvalidOperationException("Could not read window bounds");
        return rect.Left + "," + rect.Top + "," + rect.Right + "," + rect.Bottom;
    }

    public static void MoveBy(IntPtr window, int x, int y) {
        Rect rect;
        if (!GetWindowRect(window, out rect) || !SetWindowPos(window, IntPtr.Zero, rect.Left + x, rect.Top + y, 0, 0, 0x15))
            throw new InvalidOperationException("Could not move window");
    }

    // The stock progress page owns this class; its presence marks the installation stage.
    public static IntPtr FindClass(IntPtr parent, string name) {
        IntPtr result = IntPtr.Zero;
        EnumChildWindows(parent, delegate(IntPtr child, IntPtr unused) {
            var kind = new StringBuilder(128);
            GetClassName(child, kind, kind.Capacity);
            if (kind.ToString() == name) result = child;
            return result == IntPtr.Zero;
        }, IntPtr.Zero);
        return result;
    }

    // The stock finish page owns the only auto checkbox of its page.
    public static IntPtr FindCheckbox(IntPtr parent) {
        IntPtr result = IntPtr.Zero;
        EnumChildWindows(parent, delegate(IntPtr child, IntPtr unused) {
            if (result != IntPtr.Zero || !IsWindowVisible(child)) return result == IntPtr.Zero;
            var kind = new StringBuilder(64);
            GetClassName(child, kind, kind.Capacity);
            if (kind.ToString() != "Button") return true;
            if ((GetWindowLong(child, -16) & 0xF) == 3) result = child;
            return result == IntPtr.Zero;
        }, IntPtr.Zero);
        return result;
    }

    public static IntPtr FindText(int process, string expected) { return FindTextCore(process, expected, false); }
    public static IntPtr FindDialogText(int process, string expected) { return FindTextCore(process, expected, true); }

    public static IntPtr FindButton(int process, string expected) {
        IntPtr result = IntPtr.Zero;
        EnumWindows(delegate(IntPtr window, IntPtr data) {
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            if (owner != process) return true;
            EnumChildWindows(window, delegate(IntPtr child, IntPtr unused) {
                var text = new StringBuilder(256);
                var kind = new StringBuilder(64);
                GetWindowText(child, text, text.Capacity);
                GetClassName(child, kind, kind.Capacity);
                if (IsWindowVisible(child) && kind.ToString() == "Button" && text.ToString() == expected) result = child;
                return result == IntPtr.Zero;
            }, IntPtr.Zero);
            return result == IntPtr.Zero;
        }, IntPtr.Zero);
        return result;
    }

    static IntPtr FindTextCore(int process, string expected, bool dialogOnly) {
        IntPtr result = IntPtr.Zero;
        EnumWindows(delegate(IntPtr window, IntPtr data) {
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            if (owner != process) return true;
            if (dialogOnly && !IsWindowVisible(GetDlgItem(window, 1)) && !IsWindowVisible(GetDlgItem(window, 2)) && !IsWindowVisible(GetDlgItem(window, 6))) return true;
            EnumChildWindows(window, delegate(IntPtr child, IntPtr unused) {
                var text = new StringBuilder(512);
                GetWindowText(child, text, text.Capacity);
                if (IsWindowVisible(child) && text.ToString().Contains(expected)) result = child;
                return result == IntPtr.Zero;
            }, IntPtr.Zero);
            return result == IntPtr.Zero;
        }, IntPtr.Zero);
        return result;
    }

    public static string VisibleText(int process) {
        var output = new StringBuilder();
        EnumWindows(delegate(IntPtr window, IntPtr data) {
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            if (owner != process) return true;
            output.AppendLine("WINDOW " + window + " OK=" + GetDlgItem(window, 1) + " YES=" + GetDlgItem(window, 6));
            EnumChildWindows(window, delegate(IntPtr child, IntPtr unused) {
                var text = new StringBuilder(1024);
                GetWindowText(child, text, text.Capacity);
                var kind = new StringBuilder(256);
                GetClassName(child, kind, kind.Capacity);
                Rect rect;
                GetWindowRect(child, out rect);
                if (IsWindowVisible(child)) output.AppendLine(kind + " " + child + " ID=" + GetDlgCtrlID(child) + " " + rect.Left + "," + rect.Top + "," + rect.Right + "," + rect.Bottom + " " + text.ToString());
                return true;
            }, IntPtr.Zero);
            return true;
        }, IntPtr.Zero);
        return output.ToString();
    }

    public static IntPtr TopLevel(IntPtr child) { return GetAncestor(child, 2); }

    public static void Click(IntPtr control) {
        if (!PostMessage(control, 0xF5, IntPtr.Zero, IntPtr.Zero)) throw new InvalidOperationException("Could not click native button");
    }

    public static int CheckState(IntPtr control) { return SendMessage(control, 0xF0, IntPtr.Zero, IntPtr.Zero).ToInt32(); }

    public static void SetCheck(IntPtr control, int state) { SendMessage(control, 0xF1, new IntPtr(state), IntPtr.Zero); }

    // The installation page carries a shorter caption, so the wizard is matched by its product name.
    public static IntPtr Find(int process) {
        IntPtr named = IntPtr.Zero;
        IntPtr owned = IntPtr.Zero;
        EnumWindows(delegate(IntPtr window, IntPtr data) {
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            if (owner != process || !IsWindowVisible(window)) return true;
            if (owned == IntPtr.Zero) owned = window;
            var title = new StringBuilder(256);
            GetWindowText(window, title, title.Capacity);
            if (title.ToString().Contains(ProductName)) named = window;
            return true;
        }, IntPtr.Zero);
        return named != IntPtr.Zero ? named : owned;
    }

    public static void Reveal(IntPtr window) {
        ShowWindow(window, 8);
        RedrawWindow(window, IntPtr.Zero, IntPtr.Zero, 0x181);
    }

    public static string Save(IntPtr window, string path) {
        Reveal(window);
        Rect rect;
        if (!GetWindowRect(window, out rect)) throw new InvalidOperationException("Could not read window bounds");
        int width = rect.Right - rect.Left, height = rect.Bottom - rect.Top;
        using (var bitmap = new Bitmap(width, height, PixelFormat.Format24bppRgb)) {
            using (var graphics = Graphics.FromImage(bitmap)) {
                graphics.Clear(Color.White);
                IntPtr dc = graphics.GetHdc();
                try {
                    if (!PrintWindow(window, dc, 2)) throw new InvalidOperationException("PrintWindow failed");
                } finally { graphics.ReleaseHdc(dc); }
            }
            bitmap.Save(path, ImageFormat.Png);
        }
        return width + "x" + height;
    }
}
'@
}
