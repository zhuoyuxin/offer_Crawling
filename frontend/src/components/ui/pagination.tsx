import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface PaginationProps {
  page: number;
  totalPages: number;
  onChange: (next: number) => void;
}

export function Pagination({ page, totalPages, onChange }: PaginationProps) {
  const [targetPage, setTargetPage] = useState(String(page));
  const safeTotalPages = Math.max(1, totalPages);
  const jumpDisabled = safeTotalPages <= 1;

  useEffect(() => {
    setTargetPage(String(page));
  }, [page]);

  function handleJump() {
    if (jumpDisabled) {
      return;
    }
    const value = targetPage.trim();
    if (!value) {
      return;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return;
    }
    const next = Math.min(Math.max(Math.floor(parsed), 1), safeTotalPages);
    setTargetPage(String(next));
    if (next !== page) {
      onChange(next);
    }
  }

  return (
    <div className="mt-4 flex items-center justify-end gap-2">
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        上一页
      </Button>
      <span className="min-w-24 text-center text-sm text-muted-foreground">
        第 {page} / {safeTotalPages} 页
      </span>
      <Button variant="outline" size="sm" disabled={page >= safeTotalPages} onClick={() => onChange(page + 1)}>
        下一页
      </Button>
      <div className="ml-2 flex items-center gap-2">
        <Input
          type="number"
          min={1}
          max={safeTotalPages}
          value={targetPage}
          onChange={(event) => setTargetPage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleJump();
            }
          }}
          className="h-9 w-20 text-center"
          disabled={jumpDisabled}
          aria-label="目标页码"
        />
        <Button size="sm" variant="outline" onClick={handleJump} disabled={jumpDisabled}>
          跳转
        </Button>
      </div>
    </div>
  );
}
