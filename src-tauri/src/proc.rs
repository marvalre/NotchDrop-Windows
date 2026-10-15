//! Runs yt-dlp / ffmpeg / ffprobe:
//! - never shows a console window on Windows;
//! - drains stdout/stderr on their own threads (a full pipe would freeze the child) and
//!   decodes them lossily, so a non-UTF-8 byte (a "José" in a path printed in the ANSI code
//!   page) can't turn the whole output into an empty string;
//! - asks Python tools for UTF-8 output;
//! - on Windows puts the child in a Job object, so a timeout — or the app quitting — also
//!   kills grandchildren (yt-dlp.exe is a one-file launcher that starts a second process).

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

pub struct Output { pub ok: bool, pub stdout: String, pub stderr: String }

pub fn command(program: &Path) -> Command {
    let mut c = Command::new(program);
    c.env("PYTHONIOENCODING", "utf-8").env("PYTHONUTF8", "1");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}

#[cfg(windows)]
mod job {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject, TerminateJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    /// Closing the handle (Drop) kills everything still in the job.
    pub struct Job(HANDLE);
    unsafe impl Send for Job {}

    impl Job {
        pub fn for_child(child: &std::process::Child) -> Option<Job> {
            unsafe {
                let h = CreateJobObjectW(None, None).ok()?;
                let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let ok = SetInformationJobObject(h, JobObjectExtendedLimitInformation, &info as *const _ as *const _,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32).is_ok()
                    && AssignProcessToJobObject(h, HANDLE(child.as_raw_handle() as _)).is_ok();
                if !ok { let _ = CloseHandle(h); return None; }
                Some(Job(h))
            }
        }
        pub fn kill(&self) { unsafe { let _ = TerminateJobObject(self.0, 1); } }
    }
    impl Drop for Job {
        fn drop(&mut self) { unsafe { let _ = CloseHandle(self.0); } }
    }
}

fn drain(r: Option<impl Read + Send + 'static>) -> std::thread::JoinHandle<String> {
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut r) = r { let _ = r.read_to_end(&mut buf); }
        String::from_utf8_lossy(&buf).into_owned()
    })
}

pub fn run(program: &Path, args: &[String], timeout: Duration) -> Output {
    let child = command(program).args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn();
    let mut child = match child {
        Ok(c) => c,
        Err(e) => return Output { ok: false, stdout: String::new(), stderr: e.to_string() },
    };
    #[cfg(windows)]
    let job = job::Job::for_child(&child);
    let t_out = drain(child.stdout.take());
    let t_err = drain(child.stderr.take());
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break Some(s),
            Ok(None) if start.elapsed() > timeout => {
                #[cfg(windows)]
                if let Some(j) = &job { j.kill(); }
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(100)),
            Err(_) => break None,
        }
    };
    // Anything the child left running still holds the pipes; ending the job closes them.
    #[cfg(windows)]
    drop(job);
    let stdout = t_out.join().unwrap_or_default();
    let mut stderr = t_err.join().unwrap_or_default();
    if status.is_none() { stderr.push_str("\nSe agotó el tiempo y se detuvo el proceso."); }
    Output { ok: status.map(|s| s.success()).unwrap_or(false), stdout, stderr }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_utf8_output_is_kept_lossily_not_dropped() {
        // printf writes the raw byte 0xE9 ("é" in cp1252), which is not valid UTF-8.
        if !Path::new("/usr/bin/printf").exists() { return; }
        let o = run(Path::new("/usr/bin/printf"), &["C:\\\\Users\\\\Jos\\351\\\\Downloads\\\\a.mp4".to_string()], Duration::from_secs(10));
        assert!(o.ok);
        assert!(o.stdout.contains("Downloads"), "{:?}", o.stdout);
    }

    #[test]
    fn timeout_kills() {
        if !Path::new("/bin/sleep").exists() { return; }
        let t = Instant::now();
        let o = run(Path::new("/bin/sleep"), &["5".to_string()], Duration::from_millis(300));
        assert!(!o.ok && t.elapsed() < Duration::from_secs(3));
        assert!(o.stderr.contains("Se agotó el tiempo"));
    }
}
