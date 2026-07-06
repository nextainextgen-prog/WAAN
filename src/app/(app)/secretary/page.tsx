import { getChatHistory } from "@/lib/secretary";
import { SecretaryChat } from "@/components/secretary/SecretaryChat";

export const dynamic = "force-dynamic";

export default async function SecretaryPage() {
  const history = await getChatHistory(50);
  const messages = history.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  return (
    <div className="h-full">
      <SecretaryChat initialMessages={messages} />
    </div>
  );
}
