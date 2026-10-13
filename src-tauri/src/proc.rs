//! Runs yt-dlp / ffmpeg / ffprobe: never shows a console window on Windows, always
//! drains stdout/stderr on their own threads (a full pipe would freeze the child),
//! and kills the child if it runs past the deadline.

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

pub struct Output { pub ok: bool, pub stdout: String, pub stderr: String }

pub fn command(program: &Path) -> Command {
    #[allow(unused_mut)]
    let mut c = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}

pub fn run(program: &Path, args: &[String], timeout: Duration) -> Output {
    let child = command(program).args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn();
    let mut child = match child {
        Ok(c) => c,
        Err(e) => return Output { ok: false, stdout: String::new(), stderr: e.to_string() },
    };
    let mut out = child.stdout.take();
    let mut err = child.stderr.take();
    let t_out = std::thread::spawn(move || { let mut s = String::new(); if let Some(o) = out.as_mut() { let _ = o.read_to_string(&mut s); } s });
    let t_err = std::thread::spawn(move || { let mut s = String::new(); if let Some(e) = err.as_mut() { let _ = e.read_to_string(&mut s); } s });
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break Some(s),
            Ok(None) if start.elapsed() > timeout => { let _ = child.kill(); let _ = child.wait(); break None; }
            Ok(None) => std::thread::sleep(Duration::from_millis(100)),
            Err(_) => break None,
        }
    };
    let stdout = t_out.join().unwrap_or_default();
    let mut stderr = t_err.join().unwrap_or_default();
    if status.is_none() { stderr.push_str("\nSe agotó el tiempo y se detuvo el proceso."); }
    Output { ok: status.map(|s| s.success()).unwrap_or(false), stdout, stderr }
}
