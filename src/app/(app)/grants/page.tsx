import { getAllGrants } from "@/lib/data";
import { PageHeader } from "@/components/ui/PageHeader";
import { KanbanBoard, type Grant } from "@/components/grants/KanbanBoard";

export const dynamic = "force-dynamic";

export default async function GrantsPage() {
  const rows = await getAllGrants();
  const grants: Grant[] = rows.map((g) => ({
    id: g.id,
    projectName: g.projectName,
    ownerName: g.ownerName,
    source: g.source,
    amount: g.amount,
    status: g.status,
    nextDeadline: g.nextDeadline ? g.nextDeadline.toISOString() : null,
    note: g.note,
    orderIndex: g.orderIndex,
  }));

  return (
    <div className="p-5 sm:p-7 max-w-full">
      <PageHeader
        title="ทุนวิจัย"
        subtitle="ลากการ์ดเพื่อเปลี่ยนสถานะ · คลิกการ์ดเพื่อแก้ไข"
      />
      <KanbanBoard initialGrants={grants} />
    </div>
  );
}
