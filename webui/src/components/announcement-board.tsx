"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Pin, Megaphone, Info, AlertTriangle, AlertOctagon } from "lucide-react";
import { api, type Announcement } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const LEVEL_STYLES: Record<Announcement["level"], { icon: typeof Info; cardClass: string; iconClass: string; label: string }> = {
  info: {
    icon: Info,
    cardClass: "border-blue-500/30 bg-blue-500/[0.04]",
    iconClass: "text-blue-500",
    label: "通知",
  },
  notice: {
    icon: Megaphone,
    cardClass: "border-emerald-500/30 bg-emerald-500/[0.04]",
    iconClass: "text-emerald-500",
    label: "公告",
  },
  warning: {
    icon: AlertTriangle,
    cardClass: "border-amber-500/35 bg-amber-500/[0.05]",
    iconClass: "text-amber-500",
    label: "注意",
  },
  critical: {
    icon: AlertOctagon,
    cardClass: "border-destructive/40 bg-destructive/[0.05]",
    iconClass: "text-destructive",
    label: "重要",
  },
};

function formatTime(unix: number): string {
  if (!unix) return "";
  return new Date(unix * 1000).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface AnnouncementBoardProps {
  limit?: number;
  /** 折叠/展开历史的入口；默认显示前 2 条，其余折叠 */
  collapseAfter?: number;
  /** 自定义标题；传入 null 隐藏标题 */
  title?: string | null;
  /** 列表为空时是否显示占位（独立页面建议 true，dashboard 嵌入建议 false） */
  showEmptyState?: boolean;
}

export function AnnouncementBoard({
  limit = 50,
  collapseAfter = 2,
  title = "公告板",
  showEmptyState = false,
}: AnnouncementBoardProps) {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getActiveAnnouncements(limit);
      if (res.success && Array.isArray(res.data?.announcements)) {
        setItems(res.data!.announcements);
      } else {
        setError(res.message || "无法加载公告");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载公告失败");
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !showEmptyState) return null;
  if (error && !showEmptyState) return null;
  if (items.length === 0 && !showEmptyState) return null;

  const visible = expanded ? items : items.slice(0, collapseAfter);
  const hasMore = items.length > collapseAfter;

  // Empty / loading / error states for standalone page mode
  if (showEmptyState && (loading || error || items.length === 0)) {
    return (
      <section className="space-y-3">
        {title !== null && (
          <h2 className="text-sm font-bold tracking-wider uppercase text-muted-foreground flex items-center gap-2">
            <Megaphone className="h-4 w-4" />
            {title}
          </h2>
        )}
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          {loading
            ? "正在加载公告..."
            : error
              ? `公告加载失败：${error}`
              : "暂无公告"}
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      {title !== null && (
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold tracking-wider uppercase text-muted-foreground flex items-center gap-2">
            <Megaphone className="h-4 w-4" />
            {title}
            <Badge variant="secondary" className="text-[10px] font-bold">
              {items.length}
            </Badge>
          </h2>
        </div>
      )}

      <div className="space-y-2">
        {visible.map((ann) => {
          const style = LEVEL_STYLES[ann.level] || LEVEL_STYLES.info;
          const Icon = style.icon;
          return (
            <article
              key={ann.id}
              className={`rounded-xl border p-4 ${style.cardClass}`}
            >
              <header className="flex items-start gap-3">
                <div className={`mt-0.5 shrink-0 ${style.iconClass}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {ann.pinned && (
                      <Pin className="h-3.5 w-3.5 text-primary shrink-0" />
                    )}
                    {ann.title && (
                      <h3 className="text-sm font-bold leading-snug">{ann.title}</h3>
                    )}
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {style.label}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatTime(ann.created_at)}
                    {ann.updated_at && ann.updated_at !== ann.created_at && (
                      <> · 更新于 {formatTime(ann.updated_at)}</>
                    )}
                    {ann.expires_at > 0 && (
                      <> · 截止 {formatTime(ann.expires_at)}</>
                    )}
                  </p>
                </div>
              </header>
              <div className="mt-3 text-sm leading-relaxed whitespace-pre-wrap break-words">
                {ann.content}
              </div>
            </article>
          );
        })}
      </div>

      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-xs gap-1.5"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" />
              收起公告历史
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" />
              查看全部 {items.length} 条公告
            </>
          )}
        </Button>
      )}
    </section>
  );
}
