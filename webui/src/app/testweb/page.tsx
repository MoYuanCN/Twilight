"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SimTab = "home" | "auth" | "media" | "profile";

const TABS: Array<{ key: SimTab; label: string }> = [
  { key: "home", label: "首页" },
  { key: "auth", label: "认证" },
  { key: "media", label: "求片" },
  { key: "profile", label: "个人" },
];

export default function TestWebPage() {
  const [activeTab, setActiveTab] = useState<SimTab>("home");
  const [username, setUsername] = useState("demo");
  const [keyword, setKeyword] = useState("");

  const tabContent = useMemo(() => {
    if (activeTab === "home") {
      return {
        title: "首页概览",
        desc: "这里用于演示基础布局和模块状态。",
      };
    }
    if (activeTab === "auth") {
      return {
        title: "认证演示",
        desc: "用于联调登录、登出和状态刷新行为。",
      };
    }
    if (activeTab === "media") {
      return {
        title: "求片演示",
        desc: "用于联调媒体检索、提交和审批流程。",
      };
    }
    return {
      title: "个人信息",
      desc: "用于联调个人资料和偏好设置。",
    };
  }, [activeTab]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 pb-10">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="rounded-2xl border bg-card p-6"
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-black tracking-tight">TestWeb 调试台</h1>
            <p className="text-sm text-muted-foreground mt-1">已精简为核心流程联调入口。</p>
          </div>
          <Badge variant="outline" className="w-fit">Core Flows Only</Badge>
        </div>
      </motion.div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <Button
            key={tab.key}
            variant={activeTab === tab.key ? "default" : "outline"}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{tabContent.title}</CardTitle>
          <CardDescription>{tabContent.desc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>当前调试用户</Label>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="输入用户名" />
          </div>

          {activeTab === "media" && (
            <div className="space-y-2">
              <Label>检索关键词</Label>
              <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="例如：The Bear" />
            </div>
          )}

          <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
            当前页签: {TABS.find((tab) => tab.key === activeTab)?.label}，用户: {username || "未填写"}
            {activeTab === "media" ? `，关键词: ${keyword || "未填写"}` : ""}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
