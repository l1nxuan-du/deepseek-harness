// Installer helper DLL: extraction-failure reporting, uninstall data cleanup, and process lookup.
// The wizard chrome is stock NSIS, so this DLL carries no frame, welcome, or progress window.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#define UNICODE
#include <windows.h>
#include <tlhelp32.h>
#include <new>
#include "extract.h"
#include "extract-report.h"
#include "uninstall-data.h"

// Saves the extraction failure report and, unless silent, presents its headline with a copy action.
// Returns 1 when the report file was written and 0 otherwise; the dialog outcome never fails the caller.
extern "C" __declspec(dllexport) int __cdecl InstallerReportExtractFailure(
    HWND parent, int code, LPCWSTR archive, LPCWSTR destination, LPCWSTR log, LPCWSTR reportPath, int show,
    LPCWSTR title, LPCWSTR heading, LPCWSTR hint, LPCWSTR copy, LPCWSTR expand, LPCWSTR collapse, LPCWSTR savedFormat, LPCWSTR unsaved, LPCWSTR copied) {
    try {
        const std::wstring output = extract_report::ReadOutput(log);
        const std::wstring report = extract_report::Compose(code, archive, destination, output,
            extract_report::Timestamp(), extract_report::WindowsVersion());
        const bool saved = extract_report::WriteUtf8(reportPath, report);
        if (show) {
            std::wstring footer = saved ? savedFormat : unsaved;
            const auto placeholder = footer.find(L"%s");
            if (saved && placeholder != std::wstring::npos) footer.replace(placeholder, 2, reportPath);
            const extract_report::DialogStrings strings{title, heading, copy, expand, collapse, footer.c_str(), copied};
            const std::wstring content = extract_report::Headline(code, output, archive) + L"\r\n\r\n" + hint;
            extract_report::Show(parent, content, extract_report::Excerpt(report), report, strings);
        }
        return saved ? 1 : 0;
    } catch (const std::bad_alloc&) {
        return 0;
    }
}

// Runs 7-Zip under a job object and writes its UTF-8 error output to the log the failure report reads.
// The stage properties the call publishes belong to the installer's own progress window, which stock NSIS pages do not show.
// Returns 0-255 for 7-Zip exit codes, small negative values for launch failures, and any other value as the raw process status.
extern "C" __declspec(dllexport) int __cdecl InstallerExtract(HWND parent, LPCWSTR tool, LPCWSTR archive, LPCWSTR destination, LPCWSTR log) {
    try { return ExtractApplication(parent, tool, archive, destination, log); }
    catch (const std::bad_alloc&) { return LaunchFailure(ERROR_NOT_ENOUGH_MEMORY); }
}

// Returns a Win32 error code; no cleanup request may traverse a linked root or touch the protected root.
extern "C" __declspec(dllexport) DWORD __cdecl UninstallRemoveData(LPCWSTR path, LPCWSTR installation, LPCWSTR protectedRoot) {
    return uninstall_data::Remove(path, installation, protectedRoot);
}

// Returns a Win32 error code; only ordinary empty directories strictly below the stop directory are removed.
extern "C" __declspec(dllexport) DWORD __cdecl UninstallRemoveEmptyParents(LPCWSTR path, LPCWSTR stop) {
    return uninstall_data::RemoveEmptyParents(path, stop);
}

// Match the affected executable, not another user's or directory's same-named application.
// Returns 0 while running, 1 when absent, and -1 if the process list cannot be read.
extern "C" __declspec(dllexport) int __cdecl InstallerFindProcess(LPCWSTR executable) {
    WCHAR target[32768];
    DWORD length = GetLongPathNameW(executable, target, ARRAYSIZE(target));
    LPCWSTR expected = length > 0 && length < ARRAYSIZE(target) ? target : executable;
    LPCWSTR filename = wcsrchr(expected, L'\\');
    filename = filename ? filename + 1 : expected;
    HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snapshot == INVALID_HANDLE_VALUE) return -1;
    PROCESSENTRY32W entry = {};
    entry.dwSize = sizeof(entry);
    int result = 1;
    BOOL present = Process32FirstW(snapshot, &entry);
    while (present) {
        if (_wcsicmp(entry.szExeFile, filename) == 0) {
            HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, entry.th32ProcessID);
            if (process) {
                WCHAR path[32768];
                DWORD count = ARRAYSIZE(path);
                if (QueryFullProcessImageNameW(process, 0, path, &count) && _wcsicmp(path, expected) == 0) result = 0;
                CloseHandle(process);
                if (result == 0) break;
            }
        }
        present = Process32NextW(snapshot, &entry);
    }
    if (!present && GetLastError() != ERROR_NO_MORE_FILES) result = -1;
    CloseHandle(snapshot);
    return result;
}
