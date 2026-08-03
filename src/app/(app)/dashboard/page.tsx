import Link from "next/link";
import {
  Banknote,
  Hourglass,
  GitBranch,
  TrendingUp,
  CalendarClock,
  AlertTriangle,
  ArrowUpRight,
  Upload,
  Layers,
} from "lucide-react";
import { getOkrSummary } from "@/lib/data";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/dashboard/StatCard";
import { OkrGauge, StatusBarChart, OkrProgressBar } from "@/components/dashboard/OkrCharts";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { formatBaht, formatBahtShort, formatThaiDate, statusLabel, STATUS_MAP } from "@/lib/grants";
import { fiscalLabel, fiscalYearOptions, fiscalYearOf } from "@/lib/fiscal";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string }>;
}) {
  const sp = await searchParams;
  const selectedFy = Number(sp.fy) || fiscalYearOf();
  const okr = await getOkrSummary(selectedFy);

  const remaining = Math.max(okr.target - okr.received, 0);
  const behind = okr.paceDelta < 0;
  const hasAlerts = okr.overdueInstallments.length > 0 || okr.missingInstallments.length > 0;

  return (
    <div className="p-5 sm:p-7 max-w-7xl mx-auto">
      <PageHeader
        title="ภาพรวม OKR"
        subtitle={`ปีงบประมาณ ${fiscalLabel(okr.fiscalYear)} · เป้าหมายทุนวิจัย ${formatBahtShort(okr.target)} บาท · เหลืออีก ${okr.daysLeft} วัน`}
        actions={
          <Link href="/grants">
            <Button variant="primary" size="md">
              จัดการทุนวิจัย
              <ArrowUpRight className="h-4 w-4" />
            </Button>
          </Link>
        }
      />

      {/* เลือกปีงบ */}
      <div className="flex items-center gap-1.5 mb-4 overflow-x-auto">
        {fiscalYearOptions().map((fy) => (
          <Link
            key={fy}
            href={`/dashboard?fy=${fy}`}
            className={cn(
              "shrink-0 h-8 px-3.5 grid place-items-center rounded-lg text-sm font-medium transition-colors",
              fy === okr.fiscalYear
                ? "bg-primary text-white"
                : "bg-surface-2 text-muted-foreground hover:text-foreground",
            )}
          >
            ปีงบ {fiscalLabel(fy)}
          </Link>
        ))}
      </div>

      {/* ตัวเลขหลัก — เงินรับจริงมาก่อนเสมอ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="เงินรับจริงปีงบนี้"
          value={formatBahtShort(okr.received)}
          sub={`บาท · ${okr.percent}% ของเป้า`}
          icon={Banknote}
          tone="accent"
        />
        <StatCard
          label="ผูกพันแล้ว รอรับ"
          value={formatBahtShort(okr.awaiting)}
          sub={`บาท · สัญญารวม ${formatBahtShort(okr.committed)}`}
          icon={Hourglass}
          tone="primary"
        />
        <StatCard
          label="ท่อถ่วงน้ำหนัก"
          value={formatBahtShort(okr.weightedPipeline)}
          sub={`บาท · จากที่ยื่นไป ${formatBahtShort(okr.pipeline)}`}
          icon={GitBranch}
          tone="neutral"
        />
        <StatCard
          label="คาดการณ์สิ้นปีงบ"
          value={formatBahtShort(okr.forecast)}
          sub={
            okr.forecastPercent >= 100
              ? `บาท · ถึงเป้า (${okr.forecastPercent}%)`
              : `บาท · ${okr.forecastPercent}% ยังขาด ${formatBahtShort(okr.target - okr.forecast)}`
          }
          icon={TrendingUp}
          tone={okr.forecastPercent >= 100 ? "accent" : "warning"}
        />
      </div>

      {okr.totalGrants === 0 && okr.received === 0 ? (
        <Card className="mt-6">
          <CardBody className="py-14 text-center">
            <span className="grid place-items-center h-14 w-14 rounded-2xl bg-primary-soft text-primary mx-auto">
              <Layers className="h-7 w-7" />
            </span>
            <h3 className="font-display text-lg font-semibold text-foreground mt-4">
              ยังไม่มีข้อมูลทุนวิจัยในปีงบ {fiscalLabel(okr.fiscalYear)}
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
          {/* ความคืบหน้า + เส้นเป้าตามเวลา */}
          <div className="grid lg:grid-cols-3 gap-4 mt-4">
            <Card className="lg:col-span-1">
              <CardBody>
                <p className="text-sm font-semibold text-foreground mb-1">เงินรับจริงเทียบเป้า</p>
                <OkrGauge percent={okr.percent} />
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div className="rounded-[11px] bg-surface-2 p-3">
                    <p className="text-xs text-muted-foreground">รับจริงแล้ว</p>
                    <p className="font-semibold text-foreground tnum mt-0.5">{formatBaht(okr.received)}</p>
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
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div>
                    <p className="text-sm font-semibold text-foreground">เส้นทางสู่เป้า {formatBahtShort(okr.target)} บาท</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      ผ่านไป {Math.round(okr.paceRatio * 100)}% ของปีงบ
                    </p>
                  </div>
                  <Badge tone={behind ? "warning" : "success"}>
                    {behind
                      ? `ช้ากว่าเป้า ${formatBahtShort(Math.abs(okr.paceDelta))}`
                      : `นำเป้า ${formatBahtShort(okr.paceDelta)}`}
                  </Badge>
                </div>
                <OkrProgressBar
                  target={okr.target}
                  received={okr.received}
                  awaiting={okr.awaiting}
                  weightedPipeline={okr.weightedPipeline}
                  paceTarget={okr.paceTarget}
                />
                <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
                  {behind
                    ? `ณ วันนี้ควรได้ ${formatBaht(okr.paceTarget)} แต่รับจริง ${formatBaht(okr.received)} — เหลือ ${okr.daysLeft} วัน ต้องเร่งเบิกงวดที่ผูกพันไว้แล้ว ${formatBahtShort(okr.awaiting)} บาท`
                    : `เร็วกว่าแผน — ณ วันนี้เป้าอยู่ที่ ${formatBaht(okr.paceTarget)} รับจริงแล้ว ${formatBaht(okr.received)}`}
                </p>
              </CardBody>
            </Card>
          </div>

          {/* จุดที่ต้องลงมือ */}
          {hasAlerts && (
            <div className="grid lg:grid-cols-2 gap-4 mt-4">
              {okr.overdueInstallments.length > 0 && (
                <Card>
                  <CardBody>
                    <div className="flex items-center gap-2 mb-3">
                      <AlertTriangle className="h-4 w-4 text-danger" />
                      <p className="text-sm font-semibold text-foreground">
                        งวดเลยกำหนดรับ ({okr.overdueInstallments.length})
                      </p>
                    </div>
                    <ul className="space-y-2.5">
                      {okr.overdueInstallments.slice(0, 5).map((a) => (
                        <li key={a.id} className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm text-foreground truncate">{a.projectName}</p>
                            <p className="text-xs text-muted-foreground">
                              {a.label} · {formatBaht(a.amount)}
                            </p>
                          </div>
                          <Badge tone="danger">เลย {Math.abs(a.days ?? 0)} วัน</Badge>
                        </li>
                      ))}
                    </ul>
                  </CardBody>
                </Card>
              )}

              {okr.missingInstallments.length > 0 && (
                <Card>
                  <CardBody>
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="h-4 w-4 text-warning" />
                      <p className="text-sm font-semibold text-foreground">
                        ทุนที่ยังไม่ได้ลงงวดเงิน ({okr.missingInstallments.length})
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">
                      รวม {formatBahtShort(okr.missingInstallments.reduce((s, g) => s + g.amount, 0))} บาท
                      ที่ยังไม่ถูกนับเป็นเงินรับจริง
                    </p>
                    <ul className="space-y-2">
                      {okr.missingInstallments.slice(0, 5).map((g) => (
                        <li key={g.id} className="flex items-center justify-between gap-2">
                          <span className="text-sm text-foreground truncate">{g.projectName}</span>
                          <span className="text-xs text-muted-foreground tnum shrink-0">
                            {formatBahtShort(g.amount)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <Link href="/grants" className="inline-block mt-3">
                      <Button variant="outline" size="sm">
                        ไปลงงวดเงิน
                      </Button>
                    </Link>
                  </CardBody>
                </Card>
              )}
            </div>
          )}

          {/* Pipeline + งวด/deadline ที่ใกล้ถึง */}
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
                <div className="mt-5">
                  <p className="text-sm font-semibold text-foreground mb-2">มูลค่าทุนแยกตามสถานะ</p>
                  <StatusBarChart data={okr.byStatus} />
                </div>
              </CardBody>
            </Card>

            <Card className="lg:col-span-1">
              <CardBody>
                <div className="flex items-center gap-2 mb-3">
                  <Banknote className="h-4 w-4 text-primary" />
                  <p className="text-sm font-semibold text-foreground">งวดที่จะรับใน 30 วัน</p>
                </div>
                {okr.dueInstallments.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    ไม่มีงวดที่ครบกำหนดรับใน 30 วัน
                  </p>
                ) : (
                  <ul className="space-y-2.5">
                    {okr.dueInstallments.slice(0, 5).map((a) => (
                      <li key={a.id} className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm text-foreground truncate">{a.projectName}</p>
                          <p className="text-xs text-muted-foreground">
                            {a.label} · {formatBahtShort(a.amount)} บาท
                          </p>
                        </div>
                        <Badge tone={(a.days ?? 99) <= 7 ? "warning" : "neutral"}>{a.days} วัน</Badge>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="flex items-center gap-2 mt-6 mb-3">
                  <CalendarClock className="h-4 w-4 text-warning" />
                  <p className="text-sm font-semibold text-foreground">Deadline งานใกล้ถึง</p>
                </div>
                {okr.upcoming.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    ไม่มี deadline ใน 30 วันข้างหน้า
                  </p>
                ) : (
                  <ul className="space-y-2.5">
                    {okr.upcoming.slice(0, 5).map((g) => {
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
