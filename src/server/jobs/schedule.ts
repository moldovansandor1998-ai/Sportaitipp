import "server-only";
import { after } from "next/server";
import { kickJob } from "@/server/jobs/runJob";

/** A job feldolgozásának ÜTEMEZÉSE a válasz után. Production: next/server after().
 *  Scheduling-hiba dobbanik – a route NEM ad hamis 202-t. (Tesztekben vi.mock-kal mockolandó.) */
export function scheduleKick(jobId: string): void {
  after(() => kickJob(jobId).catch((e) => {
    console.error(JSON.stringify({ level: "error", scope: "kickJob", jobId, error: String(e) }));
  }));
}
