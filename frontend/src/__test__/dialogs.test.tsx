import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EditCandidateDialog } from "../components/EditCandidateDialog";
import { updateUser } from "../api/client";
import type { UserSummary } from "../types";

vi.mock("../api/client", () => ({
  updateUser: vi.fn(),
}));

const candidate: UserSummary = {
  id: 42,
  username: "ada",
  displayName: "Ada Lovelace",
  isSuperuser: false,
  roles: ["candidate"],
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("dialogs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ConfirmDialog calls cancel and confirm handlers", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onConfirm = vi.fn();

    render(
      <ConfirmDialog
        open
        title="Delete candidate"
        message="This cannot be undone"
        confirmLabel="Delete"
        cancelLabel="Keep"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Keep" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("EditCandidateDialog validates password confirmation before saving", async () => {
    const user = userEvent.setup();

    render(<EditCandidateDialog open candidate={candidate} onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.type(screen.getByPlaceholderText("留空表示不修改密碼"), "secret1");
    await user.type(screen.getByPlaceholderText("再次輸入新密碼"), "secret2");
    await user.click(screen.getByRole("button", { name: "儲存" }));

    expect(await screen.findByText("兩次密碼不一致")).toBeInTheDocument();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("EditCandidateDialog saves trimmed display name and password", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    vi.mocked(updateUser).mockResolvedValue({} as Awaited<ReturnType<typeof updateUser>>);

    render(<EditCandidateDialog open candidate={candidate} onClose={vi.fn()} onSaved={onSaved} />);

    await user.clear(screen.getByDisplayValue("Ada Lovelace"));
    await user.type(screen.getByPlaceholderText("ada"), "  Ada  ");
    await user.type(screen.getByPlaceholderText("留空表示不修改密碼"), "secret1");
    await user.type(screen.getByPlaceholderText("再次輸入新密碼"), "secret1");
    await user.click(screen.getByRole("button", { name: "儲存" }));

    expect(updateUser).toHaveBeenCalledWith(42, {
      displayName: "Ada",
      password: "secret1",
    });
    expect(onSaved).toHaveBeenCalledWith(42, "Ada");
  });
});
