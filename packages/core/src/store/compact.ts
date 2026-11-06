export function fault(point: string) {
  if (process.env.COMPOSED_FAULT === point) process.kill(process.pid, "SIGKILL");
}
