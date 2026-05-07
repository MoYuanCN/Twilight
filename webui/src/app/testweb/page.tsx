"use client";

import { useMemo, useState } from "react";
import {
  Bell,
  Bot,
  Compass,
  Film,
  Gift,
  Home,
  Loader2,
  Search,
  ShieldCheck,
  Smartphone,
  User2,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type SimTab = "home" | "media" | "score" | "profile";

type SimUser = {
  uid: number;
  username: string;
  email: string;
  roleName: string;
  embyBound: boolean;
  tgBound: boolean;
};

type SimMedia = {
  id: number;
  title: string;
  type: "movie" | "tv";
  year: number;
  source: "tmdb" | "bangumi";
};

const SIM_MEDIA: SimMedia[] = [
  { id: 1001, title: "流浪地球", type: "movie", year: 2019, source: "tmdb" },
  { id: 1002, title: "三体", type: "tv", year: 2023, source: "tmdb" },
  { id: 1003, title: "葬送的芙莉莲", type: "tv", year: 2023, source: "bangumi" },
  { id: 1004, title: "铃芽之旅", type: "movie", year: 2022, source: "bangumi" },
  { id: 1005, title: "银河护卫队", type: "movie", year: 2014, source: "tmdb" },
];

function mockDelay<T>(value: T, ms = 350): Promise<T> {
  return new Promise((resolve) => {
    window.setTimeout(() => resolve(value), ms);
  });
}

export default function TestWebPage() {
  const [activeTab, setActiveTab] = useState<SimTab>("home");
  const [loading, setLoading] = useState(false);

  const [user, setUser] = useState<SimUser>({
    uid: 9527,
    username: "mobile_tester",
    email: "tester@local.sim",
    roleName: "普通用户",
    embyBound: true,
    tgBound: true,
  });

  const [score, setScore] = useState(680);
  const [streak, setStreak] = useState(5);
  const [checkedToday, setCheckedToday] = useState(false);
  const [notice, setNotice] = useState("欢迎来到本地模拟模式，当前不会发起任何网络请求。");

  const [query, setQuery] = useState("");
  const [mediaRequests, setMediaRequests] = useState<Array<{ id: number; title: string; status: string }>>([]);

  const [transferUid, setTransferUid] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [couponCode, setCouponCode] = useState("");

  const [profileName, setProfileName] = useState(user.username);
  const [profileEmail, setProfileEmail] = useState(user.email);

  const [embyQueueState, setEmbyQueueState] = useState<"idle" | "queued" | "processing" | "success" | "failed">("idle");

  const filteredMedia = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SIM_MEDIA;
    return SIM_MEDIA.filter((item) => item.title.toLowerCase().includes(q));
  }, [query]);

  const runAction = async (action: () => Promise<void>) => {
    setLoading(true);
    try {
      await action();
    } finally {
      setLoading(false);
    }
  };

  const handleCheckin = async () => {
    await runAction(async () => {
      if (checkedToday) {
        setNotice("今日已签到，本地模拟不会重复发奖。");
        return;
      }
      const bonus = 20 + Math.floor(Math.random() * 15);
      await mockDelay(null, 300);
      setScore((prev) => prev + bonus);
      setStreak((prev) => prev + 1);
      setCheckedToday(true);
      setNotice(`签到成功 +${bonus} 积分（本地模拟）`);
    });
  };

  const handleTransfer = async () => {
    await runAction(async () => {
      const amount = Number.parseInt(transferAmount, 10);
      if (!transferUid || Number.isNaN(amount) || amount <= 0) {
        setNotice("请输入有效的目标 UID 和转账金额。");
        return;
      }
      if (amount > score) {
        setNotice("余额不足，无法转账（本地模拟校验）。");
        return;
      }
      await mockDelay(null, 360);
      setScore((prev) => prev - amount);
      setTransferUid("");
      setTransferAmount("");
      setNotice(`已向 UID ${transferUid} 转账 ${amount} 积分（本地模拟）`);
    });
  };

  const handleRedeemCoupon = async () => {
    await runAction(async () => {
      const code = couponCode.trim().toUpperCase();
      if (!code) {
        setNotice("请输入兑换码。");
        return;
      }
      await mockDelay(null, 300);
      if (code.startsWith("SIM")) {
        setScore((prev) => prev + 88);
        setNotice("兑换成功，已增加 88 积分（本地模拟）。");
      } else {
        setNotice("兑换码无效（本地模拟规则：需以 SIM 开头）。");
      }
      setCouponCode("");
    });
  };

  const handleRequestMedia = async (item: SimMedia) => {
    await runAction(async () => {
      await mockDelay(null, 280);
      const reqId = Date.now();
      setMediaRequests((prev) => [{ id: reqId, title: item.title, status: "UNHANDLED" }, ...prev].slice(0, 6));
      setNotice(`已提交《${item.title}》请求（本地模拟，不入库）。`);
    });
  };

  const handleMockEmbyRegister = async () => {
    await runAction(async () => {
      if (!user.tgBound) {
        setEmbyQueueState("failed");
        setNotice("Emby 注册模拟失败：未绑定 TG。请在“我的”中切换 TG 绑定状态。");
        return;
      }

      setEmbyQueueState("queued");
      setNotice("Emby 注册模拟：已进入本地队列。");
      await mockDelay(null, 500);
      setEmbyQueueState("processing");
      setNotice("Emby 注册模拟：本地处理中。");
      await mockDelay(null, 700);
      setEmbyQueueState("success");
      setNotice("Emby 注册模拟：已创建成功（仅本地结果，不涉及后端）。");
    });
  };

  const handleSaveProfile = async () => {
    await runAction(async () => {
      if (!profileName.trim()) {
        setNotice("昵称不能为空。");
        return;
      }
      await mockDelay(null, 360);
      setUser((prev) => ({ ...prev, username: profileName.trim(), email: profileEmail.trim() }));
      setNotice("个人资料已保存（本地模拟，仅当前页面有效）。");
    });
  };

  const navItemClass = (tab: SimTab) =>
    `flex flex-col items-center gap-1 rounded-xl py-2 text-[11px] transition ${
      activeTab === tab ? "bg-slate-900 text-white" : "text-slate-600"
    }`;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_10%_0%,#e2e8f0_0,#f8fafc_38%,#f1f5f9_100%)] px-3 py-4 sm:px-4">
      <div className="mx-auto flex w-full max-w-sm flex-col gap-4 md:max-w-2xl">
        <header className="sticky top-2 z-10 rounded-2xl border border-slate-200/80 bg-white/90 p-3 shadow-sm backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.15em] text-slate-500">Twilight Mobile Simulator</p>
              <h1 className="truncate text-lg font-semibold text-slate-900">全本地前端模拟页</h1>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white">
              <Smartphone className="h-5 w-5" />
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <Bell className="h-4 w-4" />
              <span>{notice}</span>
            </div>
            <Badge variant="secondary">Local Mock</Badge>
          </div>
        </header>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as SimTab)} className="space-y-4">
          <TabsList className="grid h-auto w-full grid-cols-4 gap-2 rounded-2xl border border-slate-200 bg-white/90 p-1">
            <TabsTrigger value="home" className="rounded-xl">首页</TabsTrigger>
            <TabsTrigger value="media" className="rounded-xl">求片</TabsTrigger>
            <TabsTrigger value="score" className="rounded-xl">积分</TabsTrigger>
            <TabsTrigger value="profile" className="rounded-xl">我的</TabsTrigger>
          </TabsList>

          <TabsContent value="home" className="space-y-3">
            <Card className="border-slate-200/90 bg-white/95">
              <CardHeader>
                <CardTitle className="text-base">模拟账户概览</CardTitle>
                <CardDescription>与主站结构对齐的本地状态卡片</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-slate-500">用户名</p>
                  <p className="mt-1 font-semibold">{user.username}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-slate-500">UID</p>
                  <p className="mt-1 font-semibold">{user.uid}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-slate-500">积分</p>
                  <p className="mt-1 font-semibold">{score}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-slate-500">连签</p>
                  <p className="mt-1 font-semibold">{streak} 天</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200/90 bg-white/95">
              <CardHeader>
                <CardTitle className="text-base">Emby 注册队列模拟</CardTitle>
                <CardDescription>本地模拟 TG 校验 + 排队 + 处理 + 完成全流程</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                  当前状态: {embyQueueState}
                </div>
                <Button variant="outline" onClick={() => void handleMockEmbyRegister()} disabled={loading} className="w-full">
                  <ShieldCheck className="mr-2 h-4 w-4" />
                  提交 Emby 注册（本地）
                </Button>
                <Button variant="outline" onClick={() => setActiveTab("media")}>
                  <Film className="mr-2 h-4 w-4" />
                  去求片
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="media" className="space-y-3">
            <Card className="border-slate-200/90 bg-white/95">
              <CardHeader>
                <CardTitle className="text-base">媒体检索（本地算法）</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <Search className="h-4 w-4 text-slate-500" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="输入关键词筛选本地数据"
                    className="h-9 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                  />
                </div>

                <div className="space-y-2">
                  {filteredMedia.map((item) => (
                    <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-slate-900">{item.title}</p>
                          <p className="text-xs text-slate-500">
                            {item.type.toUpperCase()} · {item.year} · {item.source}
                          </p>
                        </div>
                        <Button size="sm" onClick={() => void handleRequestMedia(item)} disabled={loading}>
                          提交
                        </Button>
                      </div>
                    </div>
                  ))}
                  {filteredMedia.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm text-slate-500">
                      没有匹配项（本地筛选结果）
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200/90 bg-white/95">
              <CardHeader>
                <CardTitle className="text-base">最近模拟请求</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {mediaRequests.length === 0 ? (
                  <p className="text-sm text-slate-500">暂无请求</p>
                ) : (
                  mediaRequests.map((req) => (
                    <div key={req.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                      <span>{req.title}</span>
                      <Badge variant="secondary">{req.status}</Badge>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="score" className="space-y-3">
            <Card className="border-slate-200/90 bg-white/95">
              <CardHeader>
                <CardTitle className="text-base">积分中心（本地）</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">当前余额</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">{score}</p>
                </div>

                <div className="grid grid-cols-1 gap-2">
                  <Button onClick={() => void handleCheckin()} disabled={loading || checkedToday}>
                    <Gift className="mr-2 h-4 w-4" />
                    {checkedToday ? "今日已签到" : "每日签到"}
                  </Button>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>目标 UID</Label>
                    <Input value={transferUid} onChange={(e) => setTransferUid(e.target.value)} placeholder="例如 10001" />
                  </div>
                  <div className="space-y-2">
                    <Label>转账积分</Label>
                    <Input value={transferAmount} onChange={(e) => setTransferAmount(e.target.value)} placeholder="例如 88" />
                  </div>
                </div>
                <Button variant="outline" onClick={() => void handleTransfer()} disabled={loading}>
                  <Wallet className="mr-2 h-4 w-4" />
                  模拟转账
                </Button>

                <div className="space-y-2">
                  <Label>兑换码</Label>
                  <Input value={couponCode} onChange={(e) => setCouponCode(e.target.value)} placeholder="以 SIM 开头可兑换" />
                </div>
                <Button variant="outline" onClick={() => void handleRedeemCoupon()} disabled={loading}>
                  兑换积分
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="profile" className="space-y-3">
            <Card className="border-slate-200/90 bg-white/95">
              <CardHeader>
                <CardTitle className="text-base">个人设置（本地状态）</CardTitle>
                <CardDescription>不写入后端，仅用于移动端流程演练</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <Label>用户名</Label>
                  <Input value={profileName} onChange={(e) => setProfileName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>邮箱</Label>
                  <Input value={profileEmail} onChange={(e) => setProfileEmail(e.target.value)} />
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  角色: {user.roleName} · Emby 绑定: {user.embyBound ? "是" : "否"} · TG 绑定: {user.tgBound ? "是" : "否"}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={() => setUser((prev) => ({ ...prev, tgBound: !prev.tgBound }))}>
                    <Bot className="mr-2 h-4 w-4" />
                    切换 TG 绑定
                  </Button>
                  <Button onClick={() => void handleSaveProfile()} disabled={loading}>保存本地资料</Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <nav className="sticky bottom-2 rounded-2xl border border-slate-200 bg-white/95 p-2 shadow-sm backdrop-blur">
          <ul className="grid grid-cols-4 gap-1">
            <li>
              <button className={navItemClass("home")} onClick={() => setActiveTab("home")}>
                <Home className="h-4 w-4" />
                首页
              </button>
            </li>
            <li>
              <button className={navItemClass("media")} onClick={() => setActiveTab("media")}>
                <Compass className="h-4 w-4" />
                发现
              </button>
            </li>
            <li>
              <button className={navItemClass("score")} onClick={() => setActiveTab("score")}>
                <Wallet className="h-4 w-4" />
                积分
              </button>
            </li>
            <li>
              <button className={navItemClass("profile")} onClick={() => setActiveTab("profile")}>
                <User2 className="h-4 w-4" />
                我的
              </button>
            </li>
          </ul>
        </nav>

        {loading ? (
          <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-slate-900/20 backdrop-blur-[1px]">
            <div className="rounded-xl bg-white px-4 py-3 text-sm text-slate-700 shadow-lg">
              <Loader2 className="mr-2 inline-block h-4 w-4 animate-spin" />
              本地模拟处理中...
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
