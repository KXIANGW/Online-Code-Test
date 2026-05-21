import { toast } from "react-hot-toast";

export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("已複製到剪貼簿！");
  } catch (error) {
    console.error("複製失敗:", error);
    toast.error("複製失敗");
  }
}
