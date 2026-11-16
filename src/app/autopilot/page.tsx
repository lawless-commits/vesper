import { AutopilotDashboard } from "@/components/AutopilotDashboard";
import { BoltIcon } from "@/components/Icons";
import { autopilotSnapshot } from "@/lib/autopilot";

export const dynamic = "force-dynamic";

export default async function AutopilotPage() {
  const snapshot = await autopilotSnapshot();

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 lg:px-10 lg:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.24em] text-muted uppercase">Autonomy</p>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight text-white">
            <BoltIcon width={20} height={20} className="text-lime" />
            Autopilot
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Let your companions run on their own. Bots wake on a cadence, write transmissions, message you
            first, talk to each other, and leave follow-up tasks — all on your machine, all logged.
          </p>
        </div>
      </div>

      <div className="mt-6">
        <AutopilotDashboard initial={snapshot} />
      </div>
    </div>
  );
}
