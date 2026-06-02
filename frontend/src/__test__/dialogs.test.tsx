import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
    // given
    const user = userEvent.setup();

    render(<EditCandidateDialog open candidate={candidate} onClose={vi.fn()} onSaved={vi.fn()} />);

    // when
    await user.type(screen.getByPlaceholderText("留空表示不修改密碼"), "secret1");
    await user.type(screen.getByPlaceholderText("再次輸入新密碼"), "secret2");
    await user.click(screen.getByRole("button", { name: "儲存" }));

    // expect
    expect(await screen.findByText("兩次密碼不一致")).toBeInTheDocument();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("EditCandidateDialog rejects a new password shorter than six characters", async () => {
    // given
    const user = userEvent.setup();

    render(<EditCandidateDialog open candidate={candidate} onClose={vi.fn()} onSaved={vi.fn()} />);

    // when
    await user.type(screen.getByPlaceholderText("留空表示不修改密碼"), "12345");
    await user.click(screen.getByRole("button", { name: "儲存" }));

    // expect
    expect(await screen.findByText("密碼至少 6 個字")).toBeInTheDocument();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("EditCandidateDialog saves trimmed display name and password", async () => {
    // given
    const user = userEvent.setup();
    const onSaved = vi.fn();
    vi.mocked(updateUser).mockResolvedValue({} as Awaited<ReturnType<typeof updateUser>>);

    render(<EditCandidateDialog open candidate={candidate} onClose={vi.fn()} onSaved={onSaved} />);

    // when
    await user.clear(screen.getByDisplayValue("Ada Lovelace"));
    await user.type(screen.getByPlaceholderText("ada"), "  Ada  ");
    await user.type(screen.getByPlaceholderText("留空表示不修改密碼"), "secret1");
    await user.type(screen.getByPlaceholderText("再次輸入新密碼"), "secret1");
    await user.click(screen.getByRole("button", { name: "儲存" }));

    // expect
    expect(updateUser).toHaveBeenCalledWith(42, {
      displayName: "Ada",
      password: "secret1",
    });
    expect(onSaved).toHaveBeenCalledWith(42, "Ada");
  });

  it("EditCandidateDialog shows the backend error message when saving fails", async () => {
    // given
    const user = userEvent.setup();
    const apiError = { response: { data: { message: "Display name already exists" } } };
    vi.mocked(updateUser).mockRejectedValue(apiError);

    render(<EditCandidateDialog open candidate={candidate} onClose={vi.fn()} onSaved={vi.fn()} />);

    // when
    await user.click(screen.getByRole("button", { name: "儲存" }));

    // expect
    expect(await screen.findByText("Display name already exists")).toBeInTheDocument();
  });

  it("EditCandidateDialog falls back to username when display name is cleared", async () => {
    // given
    const user = userEvent.setup();
    const onSaved = vi.fn();
    vi.mocked(updateUser).mockResolvedValue({} as Awaited<ReturnType<typeof updateUser>>);

    render(<EditCandidateDialog open candidate={candidate} onClose={vi.fn()} onSaved={onSaved} />);

    // when
    await user.clear(screen.getByDisplayValue("Ada Lovelace"));
    await user.type(screen.getByPlaceholderText("ada"), "   ");
    await user.click(screen.getByRole("button", { name: "儲存" }));

    // expect
    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith(42, {
        displayName: undefined,
        password: undefined,
      }),
    );
    expect(onSaved).toHaveBeenCalledWith(42, "ada");
  });

  it("EditCandidateDialog does not call updateUser when submitted without a candidate", async () => {
    // given
    const user = userEvent.setup();

    render(<EditCandidateDialog open candidate={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    // when
    await user.click(screen.getByRole("button", { name: "儲存" }));

    // expect
    expect(updateUser).not.toHaveBeenCalled();
  });
});
