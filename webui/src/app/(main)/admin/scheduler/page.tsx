"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  Loader2,
  PlayCircle,
  RefreshCw,
  TimerReset,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { PageError } from "@/components/layout/page-state";
import { api, type SchedulerJobItem } from "@/lib/api";

function formatTimestamp(seconds: number | null | undefined): string {
  if (!seconds) return "—";
  const d = new Date(seconds * 1000);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function formatDuration(startSec: number, endSec: number | null): string {
  if (!endSec) return "—";
  const ms = (endSec - startSec) * 1000;
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

function StatusBadge({ job }: { job: SchedulerJobItem }) {
  if (job.is_running || job.last_run?.status === "running") {
    return (
      <Badge variant="outline" className="text-[10px] border-sky-500/40 text-sky-600 dark:text-sky-400">
        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        运行中
      </Badge>
    );
  }
  if (!job.last_run) {
    return (
      <Badge variant="outline" className="text-[10px] text-muted-foreground">
        未运行
      </Badge>
    );
  }
  if (job.last_run.status === "success") {
    return (
      <Badge variant="success" className="text-[10px]">
        <CheckCircle2 className="mr-1 h-3 w-3" />
        上次成功
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="text-[10px]">
      <XCircle className="mr-1 h-3 w-3" />
      上次失败
    </Badge>
  );
}

export default function AdminSchedulerPage() {
  const { toast } = useToast();
  const [jobs, setJobs] = useState<SchedulerJobItem[]>([]);
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const pollTimerRef = useRef<number | null>(null);

  const loadJobs = useCallback(async () => {
    const res = await api.listSchedulerJobs();
    if (res.success && res.data) {
      setJobs(res.data.jobs || []);
    }
    return true;
  }, []);

  const {
    isLoading,
    error,
    execute: refresh,
  } = useAsyncResource(loadJobs, { immediate: true });

  // 任何任务在运行 → 启动 2s 轮询；都结束后停止
  const anyRunning = useMemo(
    () => jobs.some((j) => j.is_running || j.last_run?.status === "running") || Object.values(running).some(Boolean),
    [jobs, running]
  );

  useEffect(() => {
    if (!anyRunning) {
      if (pollTimerRef.current) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }
    if (pollTimerRef.current) return;
    pollTimerRef.current = window.setInterval(() => {
      void refresh();
    }, 2000);
    return () => {
      if (pollTimerRef.current) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [anyRunning, refresh]);

  const handleTrigger = async (job: SchedulerJobItem) => {
    setRunning((p) => ({ ...p, [job.id]: true }));
    try {
      const res = await api.triggerSchedulerJob(job.id);
      if (res.success) {
        toast({
          title: `已触发：${job.name}`,
          description: "任务在后台执行，可在卡片中查看状态",
          variant: "success",
        });
        // 立刻刷新一次，后续靠 polling
        await refresh();
      } else {
        toast({ title: "触发失败", description: res.message, variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "触发失败", description: err.message || "网络异常", variant: "destructive" });
    } finally {
      setRunning((p) => ({ ...p, [job.id]: false }));
    }
  };

  if (error) {
    return <PageError message={error} onRetry={() => void refresh()} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold">定时任务</h1>
          <p className="text-muted-foreground">
            手动触发后台定时任务并查看最近一次的执行情况。任务在后台异步执行，本页面会自动轮询状态。
          </p>
        </div>
        <Button variant="outline" onClick={() => void refresh()} disabled={isLoading}>
          {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          刷新
        </Button>
      </div>

      {jobs.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {isLoading ? "加载中..." : "没有可用的定时任务"}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {jobs.map((job) => {
            const lr = job.last_run;
            const triggering = Boolean(running[job.id]);
            const isRunning = job.is_running || lr?.status === "running" || triggering;
            return (
              <Card key={job.id} className="flex flex-col">
                <CardHeader className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="text-base">{job.name}</CardTitle>
                    <StatusBadge job={job} />
                  </div>
                  <CardDescription className="break-words">
                    {job.description}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 mt-auto">
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">
                        计划：{job.enabled ? job.schedule || "已注册" : "未启用"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <TimerReset className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">下次执行：{formatTimestamp(job.next_run_at)}</span>
                    </div>
                  </div>

                  {lr && (
                    <div className="rounded-md border border-border/60 bg-muted/30 p-2 text-xs space-y-0.5">
                      <p>
                        <span className="text-muted-foreground">开始：</span>
                        {formatTimestamp(lr.started_at)}
                      </p>
                      <p>
                        <span className="text-muted-foreground">结束：</span>
                        {formatTimestamp(lr.finished_at)}
                      </p>
                      <p>
                        <span className="text-muted-foreground">耗时：</span>
                        {formatDuration(lr.started_at, lr.finished_at)}
                      </p>
                      {lr.error && (
                        <p className="text-destructive break-words">
                          错误：{lr.error}
                        </p>
                      )}
                    </div>
                  )}

                  <Button
                    onClick={() => void handleTrigger(job)}
                    disabled={isRunning}
                    className="w-full"
                  >
                    {isRunning ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <PlayCircle className="mr-2 h-4 w-4" />
                    )}
                    {isRunning ? "运行中…" : "立即运行"}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
