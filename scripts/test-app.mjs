// Closing the app under test, with a limit: a quit that never finishes fails the suite instead of holding the runner.
export async function closeApp(application, seconds = 30) {
  let timer;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => { application.process().kill('SIGKILL'); reject(new Error(`The app did not quit within ${seconds} s`)); }, seconds * 1000); });
  try { await Promise.race([application.close(), limit]); } finally { clearTimeout(timer); }
}
