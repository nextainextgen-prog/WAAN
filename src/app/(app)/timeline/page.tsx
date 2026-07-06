import { CalendarClock, AlertTriangle, CircleDot, CheckCircle2 } from "lucide-react";
import { getAllGrants } from "@/lib/data";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatBaht, formatThaiDate, daysUntil, statusLabel, STATUS_MAP } from "@/lib/grants";

export const dynamic = "force-dynamic";

const monthFmt = new Intl.DateTimeFormat("th-TH", { month: "long", year: "numeric" });

export default async function TimelinePage() {
  const grants = await getAllGrants();
  const withDeadline = grants
    .filter((g) => g.nextDeadline)
    .map((g) => ({ ...g, days: daysUntil(g.nextDeadline) }))
    .sort((a, b) => new Date(a.nextDeadline!).getTime() - new Date(b.nextDeadline!).getTime());

  const overdue = withDeadline.filter((g) => (g.days ?? 0) < 0 && g.status !== "closed");
  const upcoming = withDeadline.filter((g) => !((g.days ?? 0) < 0 && g.status !== "closed"));

  // group upcoming by month
  const groups = new Map<string, typeof upcoming>();
  for (const g of upcoming) {
    const key = monthFmt.format(new Date(g.nextDeadline!));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(g);
  }

  return (
    <div className="p-5 sm:p-7 max-w-4xl mx-auto">
      <PageHeader
        title="ไทม์ไลน์ / Deadline"
        subtitle="กำหนดส่งของทุนวิจัยทั้งหมด เรียงตามวันที่"
      />

      {withDeadline.length === 0 && (
        <Card>
          <CardBody className="py-14 text-center">
            <span className="grid place-items-center h-14 w-14 rounded-2xl bg-surface-2 text-muted-foreground mx-auto">
              <CalendarClock className="h-7 w-7" />
            </span>
            <p className="text-foreground font-medium mt-4">ยังไม่มีทุนที่ระบุกำหนดส่ง</p>
            <p className="text-sm text-muted-foreground mt-1">
              เพิ่มวันครบกำหนดในหน้าทุนวิจัยเพื่อให้แสดงในไทม์ไลน์
            </p>
          </CardBody>
        </Card>
      )}

      {overdue.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-4 w-4 text-danger" />
            <h2 className="text-sm font-semibold text-danger">เลยกำหนด ({overdue.length})</h2>
          </div>
          <div className="space-y-2.5">
            {overdue.map((g) => (
              <TimelineRow key={g.id} g={g} overdue />
            ))}
          </div>
        </div>
      )}

      <div className="space-y-8">
        {[...groups.entries()].map(([month, items]) => (
          <div key={month}>
            <div className="flex items-center gap-2 mb-3">
              <CalendarClock className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">{month}</h2>
              <span className="text-xs text-muted-foreground tnum">({items.length})</span>
            </div>
            <div className="space-y-2.5">
              {items.map((g) => (
                <TimelineRow key={g.id} g={g} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TimelineRow({
  g,
  overdue,
}: {
  g: { id: string; projectName: string; status: string; amount: number; nextDeadline: Date | null; days: number | null };
  overdue?: boolean;
}) {
  const meta = STATUS_MAP[g.status];
  const urgent = !overdue && (g.days ?? 99) <= 7 && g.status !== "closed";
  const done = g.status === "closed";
  return (
    <Card>
      <CardBody className="p-4 flex items-center gap-4">
        <div className="shrink-0">
          {done ? (
            <CheckCircle2 className="h-5 w-5 text-accent" />
          ) : overdue ? (
            <AlertTriangle className="h-5 w-5 text-danger" />
          ) : (
            <CircleDot className={`h-5 w-5 ${urgent ? "text-warning" : "text-muted-foreground"}`} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground truncate">{g.projectName}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className={`inline-flex items-center gap-1.5 text-xs ${meta?.accent}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${meta?.dot}`} />
              {statusLabel(g.status)}
            </span>
            <span className="text-xs text-muted-foreground">· {formatBaht(g.amount)}</span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm text-foreground tnum">{formatThaiDate(g.nextDeadline)}</p>
          <div className="mt-1">
            {overdue ? (
              <Badge tone="danger">เลย {Math.abs(g.days ?? 0)} วัน</Badge>
            ) : done ? (
              <Badge tone="success">เสร็จสิ้น</Badge>
            ) : urgent ? (
              <Badge tone="warning">อีก {g.days} วัน</Badge>
            ) : (
              <Badge tone="neutral">อีก {g.days} วัน</Badge>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
