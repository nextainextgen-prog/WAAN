import Link from "next/link";
import {
  Target,
  TrendingUp,
  CheckCircle2,
  Layers,
  CalendarClock,
  AlertTriangle,
  ArrowUpRight,
  Upload,
} from "lucide-react";
import { getOkrSummary } from "@/lib/data";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/dashboard/StatCard";
import { OkrGauge, StatusBarChart } from "@/components/dashboard/OkrCharts";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { formatBaht, formatBahtShort, formatThaiDate, statusLabel, STATUS_MAP } from "@/lib/grants";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const okr = await getOkrSummary();
  const remaining = Math.max(okr.target - okr.actual, 0);

  return (
    <div className="p-5 sm:p-7 max-w-7xl mx-auto">
      <PageHeader
        title="ภาพรวม OKR"
        subtitle={`ปีงบประมาณ ${okr.year + 543} · เป้าหมายทุนวิจัย ${formatBahtShort(okr.target)} บาท`}
        actions={
          <Link href="/grants">
            <Button variant="primary" size="md">
              จัดการทุนวิจัย
              <ArrowUpRight className="h-4 w-4" />
            </Button>
          </Link>
        }
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="เป้าหมาย OKR"
          value={formatBahtShort(okr.target)}
          sub="บาท ต่อปี"
          icon={Target}
          tone="primary"
        />
        <StatCard
          label="ผลงานจริง"
          value={formatBahtShort(okr.actual)}
          sub={`บาท · ${okr.byStatus.filter((s) => s.key !== "submitted").reduce((a, b) => a + b.count, 0)} ทุนที่นับผล`}
          icon={TrendingUp}
          tone="accent"
        />
        <StatCard
          label="เปอร์เซ็นต์บรรลุ"
          value={`${okr.percent}%`}
          sub={okr.percent >= 100 ? "บรรลุเป้าแล้ว" : `เหลืออีก ${formatBahtShort(remaining)} บาท`}
          icon={CheckCircle2}
          tone={okr.percent >= 100 ? "accent" : "warning"}
        />
        <StatCard
          label="จำนวนทุนทั้งหมด"
          value={okr.totalGrants}
          sub="ทุนในระบบ"
          icon={Layers}
          tone="neutral"
        />
      </div>

      {/* Empty state */}
      {okr.totalGrants === 0 ? (
        <Card className="mt-6">
          <CardBody className="py-14 text-center">
            <span className="grid place-items-center h-14 w-14 rounded-2xl bg-primary-soft text-primary mx-auto">
              <Layers className="h-7 w-7" />
            </span>
            <h3 className="font-display text-lg font-semibold text-foreground mt-4">
              ยังไม่มีข้อมูลทุนวิจัยในระบบ
            </h3>
            <p className="text-sm text-muted-foreground mt-1.5 max-w-md mx-auto">
              เริ่มต้นด้วยการนำเข้าไฟล์ Excel/CSV ที่มีอยู่ หรือเพิ่มทุนทีละรายการในหน้า Kanban
            </p>
            <div className="flex items-center justify-center gap-2.5 mt-6">
              <Link href="/import">
                <Button variant="primary">
                  <Upload className="h-4 w-4" />
                  นำเข้าจาก Excel/CSV
                </Button>
              </Link>
              <Link href="/grants">
                <Button variant="outline">เพิ่มทุนด้วยตนเอง</Button>
              </Link>
            </div>
          </CardBody>
        </Card>
      ) : (
        <>
          {/* OKR progress + status chart */}
          <div className="grid lg:grid-cols-3 gap-4 mt-4">
            <Card className="lg:col-span-1">
              <CardBody>
                <p className="text-sm font-semibold text-foreground mb-1">ความคืบหน้า OKR</p>
                <OkrGauge percent={okr.percent} />
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div className="rounded-[11px] bg-surface-2 p-3">
                    <p className="text-xs text-muted-foreground">ผลงานจริง</p>
                    <p className="font-semibold text-foreground tnum mt-0.5">{formatBaht(okr.actual)}</p>
                  </div>
                  <div className="rounded-[11px] bg-surface-2 p-3">
                    <p className="text-xs text-muted-foreground">คงเหลือถึงเป้า</p>
                    <p className="font-semibold text-foreground tnum mt-0.5">{formatBaht(remaining)}</p>
                  </div>
                </div>
              </CardBody>
            </Card>

            <Card className="lg:col-span-2">
              <CardBody>
                <p className="text-sm font-semibold text-foreground mb-2">มูลค่าทุนแยกตามสถานะ</p>
                <StatusBarChart data={okr.byStatus} />
              </CardBody>
            </Card>
          </div>

          {/* Pipeline + upcoming */}
          <div className="grid lg:grid-cols-3 gap-4 mt-4">
            <Card className="lg:col-span-2">
              <CardBody>
                <p className="text-sm font-semibold text-foreground mb-3">สถานะทุนตาม Pipeline</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {okr.byStatus.map((s) => {
                    const meta = STATUS_MAP[s.key];
                    return (
                      <div key={s.key} className="rounded-[11px] border border-border p-3.5">
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${meta?.dot}`} />
                          <span className="text-xs text-muted-foreground truncate">{s.label}</span>
                        </div>
                        <p className="font-display text-xl font-semibold text-foreground mt-1.5 tnum">
                          {s.count}
                        </p>
                        <p className="text-xs text-muted-foreground tnum">{formatBahtShort(s.amount)} บาท</p>
                      </div>
                    );
                  })}
                </div>
              </CardBody>
            </Card>

            <Card className="lg:col-span-1">
              <CardBody>
                <div className="flex items-center gap-2 mb-3">
                  <CalendarClock className="h-4 w-4 text-warning" />
                  <p className="text-sm font-semibold text-foreground">Deadline ใกล้ถึง</p>
                </div>
                {okr.upcoming.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    ไม่มี deadline ใน 30 วันข้างหน้า
                  </p>
                ) : (
                  <ul className="space-y-2.5">
                    {okr.upcoming.slice(0, 6).map((g) => {
                      const overdue = (g.days ?? 0) < 0;
                      const urgent = (g.days ?? 99) <= 7;
                      return (
                        <li key={g.id} className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm text-foreground truncate">{g.projectName}</p>
                            <p className="text-xs text-muted-foreground">
                              {statusLabel(g.status)} · {formatThaiDate(g.nextDeadline)}
                            </p>
                          </div>
                          <Badge tone={overdue ? "danger" : urgent ? "warning" : "neutral"}>
                            {overdue ? (
                              <>
                                <AlertTriangle className="h-3 w-3" />
                                เลย {Math.abs(g.days ?? 0)} วัน
                              </>
                            ) : (
                              `${g.days} วัน`
                            )}
                          </Badge>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
