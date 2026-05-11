"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  Bot,
  Compass,
  Gift,
  Home,
  ListChecks,
  Loader2,
  LogIn,
  LogOut,
  Mail,
  RefreshCcw,
  Search,
  Settings2,
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

type SimTab = "home" | "auth" | "media" | "score" | "profile";
type RegisterTarget = "system" | "emby";
type QueueStatus = "queued" | "processing" | "success" | "failed";
type RequestStatus = "UNHANDLED" | "APPROVED" | "REJECTED";
type ScoreAction = "checkin" | "transfer-in" | "transfer-out" | "redeem" | "register";

type SimAccount = {
  uid: number;
  username: string;
  password: string;
  email: string;
  roleName: string;
  tgBound: boolean;
  embyBound: boolean;
  embyUsername?: string;
  score: number;
  streak: number;
  checkedToday: boolean;
};

type SimMedia = {
  id: number;
  title: string;
  type: "movie" | "tv";
  year: number;
  source: "tmdb" | "bangumi";
};

type SimMediaRequest = {
  id: number;
  uid: number;
  title: string;
  status: RequestStatus;
  createdAt: number;
};

type SimQueueTicket = {
  requestId: string;
  statusToken: string;
  username: string;
  uid?: number;
  status: QueueStatus;
  message: string;
  createdAt: number;
  updatedAt: number;
  finishedAt?: number;
  data?: {
    username: string;
    emby_password?: string;
  };
};

type SimScoreHistory = {
  id: number;
  uid: number;
  type: ScoreAction;
  amount: number;
  note: string;
  createdAt: number;
};

type QueueLookup = {
  requestId: string;
  statusToken: string;
  username: string;
};

type SimConfig = {
  systemRegisterEnabled: boolean;
  embyDirectRegisterEnabled: boolean;
  forceTelegramBind: boolean;
  embyWorkers: number;
  embyMaxQueue: number;
  embyMaxUsers: number;
};

const SIM_MEDIA: SimMedia[] = [
  { id: 1001, title: "流浪地球", type: "movie", year: 2019, source: "tmdb" },
  { id: 1002, title: "三体", type: "tv", year: 2023, source: "tmdb" },
  { id: 1003, title: "葬送的芙莉莲", type: "tv", year: 2023, source: "bangumi" },
  { id: 1004, title: "铃芽之旅", type: "movie", year: 2022, source: "bangumi" },
  { id: 1005, title: "银河护卫队", type: "movie", year: 2014, source: "tmdb" },
  { id: 1006, title: "间谍过家家", type: "tv", year: 2022, source: "bangumi" },
  { id: 1007, title: "奥本海默", type: "movie", year: 2023, source: "tmdb" },
];

const QUEUE_STATUS_TEXT: Record<QueueStatus, string> = {
  queued: "排队中",
  processing: "处理中",
  success: "已成功",
  failed: "已失败",
};

const REQUEST_STATUS_TEXT: Record<RequestStatus, string> = {
  UNHANDLED: "待处理",
  APPROVED: "已通过",
  REJECTED: "已拒绝",
};

const SCORE_ACTION_TEXT: Record<ScoreAction, string> = {
  checkin: "每日签到",
  "transfer-in": "收到转账",
  "transfer-out": "转出积分",
  redeem: "兑换码",
  register: "新用户奖励",
};

function mockDelay<T>(value: T, ms = 380): Promise<T> {
  return new Promise((resolve) => {
    globalThis.setTimeout(() => resolve(value), ms);
  });
}

function randomPassword(length = 10): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function ticketId() {
  return `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function historyId() {
  return Date.now() + Math.floor(Math.random() * 1000);
}

function isPending(status: QueueStatus) {
  return status === "queued" || status === "processing";
}

export default function TestWebPage() {
  const [activeTab, setActiveTab] = useState<SimTab>("home");
  const [loadingLabel, setLoadingLabel] = useState<string | null>(null);
  const [notice, setNotice] = useState("移动端模拟页已启动：所有请求均为本地计算，不访问后端接口。");

  const [config, setConfig] = useState<SimConfig>({
    systemRegisterEnabled: true,
    embyDirectRegisterEnabled: true,
    forceTelegramBind: true,
    embyWorkers: 4,
    embyMaxQueue: 450,
    embyMaxUsers: 1200,
  });

  const [accounts, setAccounts] = useState<SimAccount[]>([
    {
      uid: 9527,
      username: "mobile_tester",
      password: "demo123456",
      email: "tester@local.sim",
      roleName: "普通用户",
      tgBound: true,
      embyBound: true,
      embyUsername: "mobile_tester",
      score: 680,
      streak: 5,
      checkedToday: false,
    },
  ]);
  const [sessionUid, setSessionUid] = useState<number | null>(9527);

  const [mediaQuery, setMediaQuery] = useState("");
  const [mediaRequests, setMediaRequests] = useState<SimMediaRequest[]>([]);

  const [scoreHistory, setScoreHistory] = useState<SimScoreHistory[]>([]);
  const [transferUid, setTransferUid] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [couponCode, setCouponCode] = useState("");

  const [loginForm, setLoginForm] = useState({ username: "mobile_tester", password: "demo123456" });
  const [registerTarget, setRegisterTarget] = useState<RegisterTarget>("system");
  const [registerForm, setRegisterForm] = useState({
    username: "",
    password: "",
    email: "",
    tgCode: "",
  });

  const [queueTickets, setQueueTickets] = useState<SimQueueTicket[]>([]);
  const [queueLookup, setQueueLookup] = useState<QueueLookup | null>(null);
  const [queueStatusView, setQueueStatusView] = useState<SimQueueTicket | null>(null);

  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");

  const ticketByUsernameRef = useRef<Record<string, string>>({});
  const queueTimersRef = useRef<Record<string, Array<ReturnType<typeof setTimeout>>>>({});

  const sessionAccount = useMemo(
    () => accounts.find((item) => item.uid === sessionUid) || null,
    [accounts, sessionUid]
  );

  useEffect(() => {
    if (!sessionAccount) {
      setProfileName("");
      setProfileEmail("");
      return;
    }
    setProfileName(sessionAccount.username);
    setProfileEmail(sessionAccount.email);
  }, [sessionAccount]);

  useEffect(() => {
    return () => {
      Object.values(queueTimersRef.current).forEach((timers) => {
        timers.forEach((t) => clearTimeout(t));
      });
      queueTimersRef.current = {};
    };
  }, []);

  const embyUserCount = useMemo(
    () => accounts.filter((item) => item.embyBound).length,
    [accounts]
  );

  const pendingTickets = useMemo(
    () => queueTickets.filter((item) => isPending(item.status)).sort((a, b) => a.createdAt - b.createdAt),
    [queueTickets]
  );

  const queueSnapshot = useMemo(() => {
    return {
      queued: queueTickets.filter((item) => item.status === "queued").length,
      processing: queueTickets.filter((item) => item.status === "processing").length,
      success: queueTickets.filter((item) => item.status === "success").length,
      failed: queueTickets.filter((item) => item.status === "failed").length,
    };
  }, [queueTickets]);

  const filteredMedia = useMemo(() => {
    const q = mediaQuery.trim().toLowerCase();
    if (!q) return SIM_MEDIA;
    return SIM_MEDIA.filter((item) => item.title.toLowerCase().includes(q));
  }, [mediaQuery]);

  const sessionRequests = useMemo(() => {
    if (!sessionUid) return [];
    return mediaRequests.filter((item) => item.uid === sessionUid);
  }, [mediaRequests, sessionUid]);

  const sessionScoreHistory = useMemo(() => {
    if (!sessionUid) return [];
    return scoreHistory
      .filter((item) => item.uid === sessionUid)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 8);
  }, [scoreHistory, sessionUid]);

  const runAction = async (label: string, action: () => Promise<void>) => {
    setLoadingLabel(label);
    try {
      await action();
    } finally {
      setLoadingLabel(null);
    }
  };

  const updateAccount = (uid: number, updater: (current: SimAccount) => SimAccount) => {
    setAccounts((prev) => prev.map((item) => (item.uid === uid ? updater(item) : item)));
  };

  const appendScoreHistory = (uid: number, type: ScoreAction, amount: number, note: string) => {
    setScoreHistory((prev) => [{ id: historyId(), uid, type, amount, note, createdAt: Date.now() }, ...prev].slice(0, 120));
  };

  const getQueuePosition = (requestId: string) => {
    const idx = pendingTickets.findIndex((item) => item.requestId === requestId);
    return idx >= 0 ? idx + 1 : undefined;
  };

  const setTicketState = (
    requestId: string,
    updater: (ticket: SimQueueTicket) => SimQueueTicket
  ) => {
    setQueueTickets((prev) => prev.map((item) => (item.requestId === requestId ? updater(item) : item)));
  };

  const scheduleQueue = (ticket: SimQueueTicket, queuePosition: number) => {
    const workers = Math.max(1, config.embyWorkers);
    const slot = Math.floor((Math.max(queuePosition, 1) - 1) / workers);
    const toProcessingMs = 700 + slot * 900;
    const toResultMs = toProcessingMs + 1200 + Math.floor(Math.random() * 800);

    const processingTimer = setTimeout(() => {
      setTicketState(ticket.requestId, (current) => {
        if (current.status !== "queued") return current;
        return {
          ...current,
          status: "processing",
          message: "已分配 worker，正在创建 Emby 账号",
          updatedAt: Date.now(),
        };
      });
    }, toProcessingMs);

    const resultTimer = setTimeout(() => {
      const success = Math.random() > 0.08;
      setTicketState(ticket.requestId, (current) => {
        if (current.status === "success" || current.status === "failed") return current;
        if (!success) {
          return {
            ...current,
            status: "failed",
            message: "模拟失败：上游风控拒绝，请稍后重试",
            updatedAt: Date.now(),
            finishedAt: Date.now(),
          };
        }

        const embyPassword = randomPassword(12);
        const targetUid = current.uid;

        if (targetUid) {
          updateAccount(targetUid, (acc) => ({
            ...acc,
            embyBound: true,
            embyUsername: current.username,
          }));
        } else {
          setAccounts((prev) => {
            if (prev.some((acc) => acc.username === current.username)) return prev;
            return [
              {
                uid: Math.floor(10000 + Math.random() * 89999),
                username: current.username,
                password: randomPassword(10),
                email: `${current.username}@local.sim`,
                roleName: "普通用户",
                tgBound: true,
                embyBound: true,
                embyUsername: current.username,
                score: 60,
                streak: 0,
                checkedToday: false,
              },
              ...prev,
            ];
          });
        }

        return {
          ...current,
          status: "success",
          message: "Emby 账号创建成功（本地模拟结果）",
          updatedAt: Date.now(),
          finishedAt: Date.now(),
          data: {
            username: current.username,
            emby_password: embyPassword,
          },
        };
      });
    }, toResultMs);

    queueTimersRef.current[ticket.requestId] = [processingTimer, resultTimer];
  };

  const pollQueueStatus = async (silent = false) => {
    if (!queueLookup) return;

    const ticket = queueTickets.find((item) => item.requestId === queueLookup.requestId);
    if (!ticket) {
      setNotice("队列票据不存在，可能已过期（本地模拟）。");
      setQueueStatusView(null);
      return;
    }

    if (ticket.statusToken !== queueLookup.statusToken) {
      setNotice("状态 token 校验失败（本地模拟）。");
      return;
    }

    const position = getQueuePosition(ticket.requestId);
    const merged: SimQueueTicket = {
      ...ticket,
      message: position ? `当前排队位置 ${position}` : ticket.message,
    };
    setQueueStatusView(merged);

    if (!silent) {
      setNotice(`队列状态已刷新：${QUEUE_STATUS_TEXT[ticket.status]}`);
    }
  };

  useEffect(() => {
    if (!queueLookup) return;
    if (queueStatusView?.status === "success" || queueStatusView?.status === "failed") return;
    const timer = setInterval(() => {
      void pollQueueStatus(true);
    }, 1200);
    return () => clearInterval(timer);
  }, [queueLookup, queueStatusView?.status, queueTickets]);

  const handleLogin = async () => {
    await runAction("正在模拟登录", async () => {
      const username = loginForm.username.trim();
      const password = loginForm.password;
      if (!username || !password) {
        setNotice("请输入用户名和密码。\n");
        return;
      }

      await mockDelay(null, 300);
      const account = accounts.find((item) => item.username === username && item.password === password);
      if (!account) {
        setNotice("登录失败：账号或密码错误（本地模拟）。");
        return;
      }

      setSessionUid(account.uid);
      setActiveTab("home");
      setNotice(`登录成功，欢迎回来 ${account.username}。`);
    });
  };

  const handleLogout = async () => {
    await runAction("正在退出会话", async () => {
      await mockDelay(null, 220);
      setSessionUid(null);
      setActiveTab("auth");
      setNotice("已退出登录（本地会话已清空）。");
    });
  };

  const handleSystemRegister = async () => {
    await runAction("正在创建系统账号", async () => {
      if (!config.systemRegisterEnabled) {
        setNotice("系统账号注册已关闭（本地配置）。");
        return;
      }

      const username = registerForm.username.trim();
      const password = registerForm.password;
      const email = registerForm.email.trim();
      const tgCode = registerForm.tgCode.trim();

      if (!username || !password || !email) {
        setNotice("系统账号注册需要用户名、密码和邮箱。\n");
        return;
      }

      if (!email.includes("@")) {
        setNotice("邮箱格式不正确。\n");
        return;
      }

      if (accounts.some((item) => item.username === username)) {
        setNotice("用户名已存在，请更换。\n");
        return;
      }

      if (config.forceTelegramBind && !tgCode) {
        setNotice("当前配置要求先提供 TG 绑定码。\n");
        return;
      }

      await mockDelay(null, 380);
      const uid = Math.floor(10000 + Math.random() * 89999);
      const account: SimAccount = {
        uid,
        username,
        password,
        email,
        roleName: "普通用户",
        tgBound: Boolean(tgCode),
        embyBound: false,
        score: 120,
        streak: 0,
        checkedToday: false,
      };
      setAccounts((prev) => [account, ...prev]);
      appendScoreHistory(uid, "register", 120, "系统账号注册奖励");
      setSessionUid(uid);
      setActiveTab("home");
      setNotice("系统账号注册成功：可用于 Twilight 网页登录，不会自动创建 Emby 账号。\n");
    });
  };

  const handleEmbyRegister = async () => {
    await runAction("正在提交 Emby 注册", async () => {
      if (!config.embyDirectRegisterEnabled) {
        setNotice("Emby 自由注册未开启（本地配置）。");
        return;
      }

      if (embyUserCount >= config.embyMaxUsers) {
        setNotice("Emby 注册已达人数上限（本地模拟）。");
        return;
      }

      const username = registerForm.username.trim();
      const tgCode = registerForm.tgCode.trim();
      if (!username) {
        setNotice("Emby 注册至少需要用户名。\n");
        return;
      }

      if (config.forceTelegramBind && !tgCode) {
        setNotice("Emby 注册要求 TG 绑定码。\n");
        return;
      }

      const pendingCount = queueTickets.filter((item) => isPending(item.status)).length;
      if (pendingCount >= config.embyMaxQueue) {
        setNotice("注册队列已满，请稍后重试。\n");
        return;
      }

      await mockDelay(null, 260);

      const mappedId = ticketByUsernameRef.current[username];
      const existing = mappedId
        ? queueTickets.find((item) => item.requestId === mappedId && isPending(item.status))
        : undefined;

      if (existing) {
        setQueueLookup({ requestId: existing.requestId, statusToken: existing.statusToken, username });
        setQueueStatusView(existing);
        setNotice("检测到同名请求，已复用原队列票据。\n");
        return;
      }

      const targetAccount = accounts.find((item) => item.username === username);
      const requestId = ticketId();
      const statusToken = randomPassword(18);
      const createdAt = Date.now();
      const queuePosition = pendingCount + 1;

      const ticket: SimQueueTicket = {
        requestId,
        statusToken,
        username,
        uid: targetAccount?.uid,
        status: "queued",
        message: "已进入注册队列，等待 worker 处理",
        createdAt,
        updatedAt: createdAt,
      };

      ticketByUsernameRef.current[username] = requestId;
      setQueueTickets((prev) => [ticket, ...prev]);
      setQueueLookup({ requestId, statusToken, username });
      setQueueStatusView(ticket);
      scheduleQueue(ticket, queuePosition);
      setNotice(`Emby 注册提交成功，当前排队位置约 ${queuePosition}。`);
    });
  };

  const handleRegister = async () => {
    if (registerTarget === "system") {
      await handleSystemRegister();
      return;
    }
    await handleEmbyRegister();
  };

  const handleRequestMedia = async (item: SimMedia) => {
    if (!sessionAccount) {
      setNotice("请先登录后再提交求片。\n");
      setActiveTab("auth");
      return;
    }

    await runAction("正在提交求片", async () => {
      await mockDelay(null, 320);
      const status: RequestStatus = Math.random() > 0.75 ? "APPROVED" : "UNHANDLED";
      setMediaRequests((prev) => [
        {
          id: historyId(),
          uid: sessionAccount.uid,
          title: item.title,
          status,
          createdAt: Date.now(),
        },
        ...prev,
      ]);
      setNotice(`《${item.title}》已提交（本地模拟），当前状态：${REQUEST_STATUS_TEXT[status]}。`);
    });
  };

  const handleCheckin = async () => {
    if (!sessionAccount) {
      setNotice("请先登录后再签到。\n");
      setActiveTab("auth");
      return;
    }

    await runAction("签到处理中", async () => {
      if (sessionAccount.checkedToday) {
        setNotice("今日已签到，本地模拟不会重复发奖。\n");
        return;
      }

      const bonus = 20 + Math.floor(Math.random() * 20);
      await mockDelay(null, 260);
      updateAccount(sessionAccount.uid, (acc) => ({
        ...acc,
        score: acc.score + bonus,
        streak: acc.streak + 1,
        checkedToday: true,
      }));
      appendScoreHistory(sessionAccount.uid, "checkin", bonus, "每日签到奖励");
      setNotice(`签到成功 +${bonus} 积分。`);
    });
  };

  const handleTransfer = async () => {
    if (!sessionAccount) {
      setNotice("请先登录后再转账。\n");
      setActiveTab("auth");
      return;
    }

    await runAction("转账处理中", async () => {
      const targetUid = Number.parseInt(transferUid, 10);
      const amount = Number.parseInt(transferAmount, 10);
      if (Number.isNaN(targetUid) || Number.isNaN(amount) || amount <= 0) {
        setNotice("请输入有效的目标 UID 与转账金额。\n");
        return;
      }

      const target = accounts.find((item) => item.uid === targetUid);
      if (!target) {
        setNotice("目标 UID 不存在。\n");
        return;
      }

      if (targetUid === sessionAccount.uid) {
        setNotice("不能给自己转账。\n");
        return;
      }

      if (sessionAccount.score < amount) {
        setNotice("积分余额不足。\n");
        return;
      }

      await mockDelay(null, 360);
      updateAccount(sessionAccount.uid, (acc) => ({ ...acc, score: acc.score - amount }));
      updateAccount(targetUid, (acc) => ({ ...acc, score: acc.score + amount }));
      appendScoreHistory(sessionAccount.uid, "transfer-out", -amount, `转账给 UID ${targetUid}`);
      appendScoreHistory(targetUid, "transfer-in", amount, `来自 UID ${sessionAccount.uid}`);
      setTransferUid("");
      setTransferAmount("");
      setNotice(`已向 UID ${targetUid} 转账 ${amount} 积分。`);
    });
  };

  const handleRedeemCoupon = async () => {
    if (!sessionAccount) {
      setNotice("请先登录后再兑换积分。\n");
      setActiveTab("auth");
      return;
    }

    await runAction("兑换处理中", async () => {
      const code = couponCode.trim().toUpperCase();
      if (!code) {
        setNotice("请输入兑换码。\n");
        return;
      }

      await mockDelay(null, 250);
      if (!code.startsWith("SIM")) {
        setNotice("兑换失败：本地规则要求兑换码以 SIM 开头。\n");
        return;
      }

      const reward = 66 + Math.floor(Math.random() * 33);
      updateAccount(sessionAccount.uid, (acc) => ({ ...acc, score: acc.score + reward }));
      appendScoreHistory(sessionAccount.uid, "redeem", reward, `兑换码 ${code}`);
      setCouponCode("");
      setNotice(`兑换成功 +${reward} 积分。`);
    });
  };

  const handleSaveProfile = async () => {
    if (!sessionAccount) {
      setNotice("请先登录后再修改资料。\n");
      setActiveTab("auth");
      return;
    }

    await runAction("正在保存资料", async () => {
      const nextName = profileName.trim();
      const nextEmail = profileEmail.trim();
      if (!nextName || !nextEmail) {
        setNotice("用户名和邮箱不能为空。\n");
        return;
      }
      if (!nextEmail.includes("@")) {
        setNotice("邮箱格式不正确。\n");
        return;
      }
      if (nextName !== sessionAccount.username && accounts.some((item) => item.username === nextName)) {
        setNotice("用户名已被占用。\n");
        return;
      }

      await mockDelay(null, 320);
      updateAccount(sessionAccount.uid, (acc) => ({
        ...acc,
        username: nextName,
        email: nextEmail,
      }));

      if (queueLookup?.username === sessionAccount.username) {
        setQueueLookup({ ...queueLookup, username: nextName });
      }

      setNotice("个人资料已保存（本地模拟）。");
    });
  };

  const navItemClass = (tab: SimTab) =>
    `flex flex-col items-center gap-1 rounded-xl py-2 text-[11px] transition ${
      activeTab === tab ? "bg-slate-900 text-white" : "text-slate-600"
    }`;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_12%_0%,#dbeafe_0,#f8fafc_42%,#e2e8f0_100%)] px-3 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-4">
      <div className="mx-auto flex w-full max-w-sm flex-col gap-4 md:max-w-3xl">
        <header className="sticky top-2 z-10 rounded-2xl border border-slate-200/80 bg-white/90 p-3 shadow-sm backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.15em] text-slate-500">Twilight Mobile Simulator</p>
              <h1 className="truncate text-lg font-semibold text-slate-900">本地接口全链路模拟页</h1>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white">
              <Smartphone className="h-5 w-5" />
            </div>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5 text-slate-700">
              网络: <span className="font-semibold text-emerald-600">OFF</span>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5 text-slate-700">
              API: <span className="font-semibold">Local Mock</span>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5 text-slate-700">
              Worker: <span className="font-semibold">{config.embyWorkers}</span>
            </div>
          </div>

          <div className="mt-3 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <Bell className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{notice}</span>
          </div>
        </header>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as SimTab)} className="space-y-4">
          <TabsList className="grid h-auto w-full grid-cols-5 gap-2 rounded-2xl border border-slate-200 bg-white/90 p-1">
            <TabsTrigger value="home" className="rounded-xl">首页</TabsTrigger>
            <TabsTrigger value="auth" className="rounded-xl">账号</TabsTrigger>
            <TabsTrigger value="media" className="rounded-xl">求片</TabsTrigger>
            <TabsTrigger value="score" className="rounded-xl">积分</TabsTrigger>
            <TabsTrigger value="profile" className="rounded-xl">我的</TabsTrigger>
          </TabsList>

          <TabsContent value="home" className="space-y-3">
            <Card className="border-slate-200/90 bg-white/95">
              <CardHeader>
                <CardTitle className="text-base">会话与能力概览</CardTitle>
                <CardDescription>模拟主前端同类信息结构，所有数据来自本地状态。</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-slate-500">当前会话</p>
                  <p className="mt-1 font-semibold">{sessionAccount ? sessionAccount.username : "未登录"}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-slate-500">UID</p>
                  <p className="mt-1 font-semibold">{sessionAccount ? sessionAccount.uid : "-"}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-slate-500">系统账号注册</p>
                  <p className="mt-1 font-semibold">{config.systemRegisterEnabled ? "已开启" : "已关闭"}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-slate-500">Emby 自由注册</p>
                  <p className="mt-1 font-semibold">{config.embyDirectRegisterEnabled ? "已开启" : "已关闭"}</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200/90 bg-white/95">
              <CardHeader>
                <CardTitle className="text-base">Emby 注册队列模拟</CardTitle>
                <CardDescription>覆盖排队、并发 worker 处理、成功/失败回执、状态轮询。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">排队: {queueSnapshot.queued}</div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">处理中: {queueSnapshot.processing}</div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">成功: {queueSnapshot.success}</div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">失败: {queueSnapshot.failed}</div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                  Emby 用户: {embyUserCount}/{config.embyMaxUsers} · 队列容量上限: {config.embyMaxQueue}
                </div>

                {queueStatusView ? (
                  <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
                    <p className="font-semibold text-slate-900">当前票据: {queueStatusView.requestId}</p>
                    <p className="mt-1 text-slate-700">状态: {QUEUE_STATUS_TEXT[queueStatusView.status]}</p>
                    <p className="mt-1 text-slate-600">说明: {queueStatusView.message}</p>
                    {queueStatusView.data?.emby_password ? (
                      <p className="mt-1 text-slate-700">临时密码: <span className="font-mono">{queueStatusView.data.emby_password}</span></p>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-500">
                    暂无活跃队列票据，前往“账号”页提交 Emby 注册。
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={() => void pollQueueStatus()} disabled={!queueLookup}>
                    <RefreshCcw className="mr-2 h-4 w-4" />
                    刷新票据
                  </Button>
                  <Button variant="outline" onClick={() => setActiveTab("auth")}>
                    <ShieldCheck className="mr-2 h-4 w-4" />
                    去提交注册
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200/90 bg-white/95">
              <CardHeader>
                <CardTitle className="text-base">模拟配置（本地）</CardTitle>
                <CardDescription>用于压测流程演练，不影响真实系统。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Button
                    variant="outline"
                    onClick={() => setConfig((prev) => ({ ...prev, forceTelegramBind: !prev.forceTelegramBind }))}
                  >
                    <Bot className="mr-2 h-4 w-4" />
                    TG 绑定校验: {config.forceTelegramBind ? "开启" : "关闭"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setConfig((prev) => ({ ...prev, embyDirectRegisterEnabled: !prev.embyDirectRegisterEnabled }))}
                  >
                    <Settings2 className="mr-2 h-4 w-4" />
                    Emby 自由注册: {config.embyDirectRegisterEnabled ? "开启" : "关闭"}
                  </Button>
                </div>
                <p className="text-xs text-slate-500">
                  模拟页不会调用 fetch/XHR，所有接口返回均由页面状态机生成，适合在本地进行移动端交互演练与安全测试。
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="auth" className="space-y-3">
            <Card className="border-slate-200/90 bg-white/95">
              <CardHeader>
                <CardTitle className="text-base">登录（系统账号）</CardTitle>
                <CardDescription>用于 Twilight 网页端会话，不等于 Emby 注册。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <Label>用户名</Label>
                  <Input
                    value={loginForm.username}
                    onChange={(e) => setLoginForm((prev) => ({ ...prev, username: e.target.value }))}
                    placeholder="例如 mobile_tester"
                  />
                </div>
                <div className="space-y-2">
                  <Label>密码</Label>
                  <Input
                    type="password"
                    value={loginForm.password}
                    onChange={(e) => setLoginForm((prev) => ({ ...prev, password: e.target.value }))}
                    placeholder="输入系统账号密码"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button onClick={() => void handleLogin()}>
                    <LogIn className="mr-2 h-4 w-4" />
                    登录
                  </Button>
                  <Button variant="outline" onClick={() => void handleLogout()} disabled={!sessionAccount}>
                    <LogOut className="mr-2 h-4 w-4" />
                    退出
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200/90 bg-white/95">
              <CardHeader>
                <CardTitle className="text-base">注册入口分流</CardTitle>
                <CardDescription>
                  系统账号注册与 Emby 账号注册完全分离。Emby 注册始终走本地队列状态机。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Tabs value={registerTarget} onValueChange={(v) => setRegisterTarget(v as RegisterTarget)}>
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="system">系统账号注册</TabsTrigger>
                    <TabsTrigger value="emby">Emby 账号注册</TabsTrigger>
                  </TabsList>
                  <TabsContent value="system" className="mt-3 rounded-xl border border-border/70 bg-muted/30 p-3 text-sm text-muted-foreground">
                    用于网页登录、个人资料与常规业务；不会自动创建 Emby 账号。
                  </TabsContent>
                  <TabsContent value="emby" className="mt-3 rounded-xl border border-border/70 bg-muted/30 p-3 text-sm text-muted-foreground">
                    进入注册队列后由 worker 模拟异步创建，并通过 requestId + statusToken 轮询状态。
                  </TabsContent>
                </Tabs>

                <div className="space-y-2">
                  <Label>用户名</Label>
                  <Input
                    value={registerForm.username}
                    onChange={(e) => setRegisterForm((prev) => ({ ...prev, username: e.target.value }))}
                    placeholder={registerTarget === "system" ? "系统登录用户名" : "目标 Emby 用户名"}
                  />
                </div>

                <div className="space-y-2">
                  <Label>邮箱（系统账号必填）</Label>
                  <Input
                    value={registerForm.email}
                    onChange={(e) => setRegisterForm((prev) => ({ ...prev, email: e.target.value }))}
                    placeholder="name@example.com"
                  />
                </div>

                <div className="space-y-2">
                  <Label>密码（系统账号必填）</Label>
                  <Input
                    type="password"
                    value={registerForm.password}
                    onChange={(e) => setRegisterForm((prev) => ({ ...prev, password: e.target.value }))}
                    placeholder="系统账号密码"
                  />
                </div>

                <div className="space-y-2">
                  <Label>TG 绑定码（可选/按配置必填）</Label>
                  <Input
                    value={registerForm.tgCode}
                    onChange={(e) => setRegisterForm((prev) => ({ ...prev, tgCode: e.target.value }))}
                    placeholder="例如 123456"
                  />
                </div>

                <Button onClick={() => void handleRegister()} disabled={Boolean(loadingLabel)} className="w-full">
                  {registerTarget === "system" ? "注册系统账号" : "提交 Emby 队列"}
                </Button>

                {queueStatusView ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                    <p>requestId: {queueStatusView.requestId}</p>
                    <p>状态: {QUEUE_STATUS_TEXT[queueStatusView.status]}</p>
                    <p>说明: {queueStatusView.message}</p>
                    {queueStatusView.data?.emby_password ? <p>密码: <span className="font-mono">{queueStatusView.data.emby_password}</span></p> : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="media" className="space-y-3">
            <Card className="border-slate-200/90 bg-white/95">
              <CardHeader>
                <CardTitle className="text-base">媒体检索（本地算法）</CardTitle>
                <CardDescription>模拟主站求片流程：搜索 {"->"} 提交请求 {"->"} 查看状态。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <Search className="h-4 w-4 text-slate-500" />
                  <Input
                    value={mediaQuery}
                    onChange={(e) => setMediaQuery(e.target.value)}
                    placeholder="输入关键词筛选本地媒体池"
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
                        <Button size="sm" onClick={() => void handleRequestMedia(item)}>
                          提交
                        </Button>
                      </div>
                    </div>
                  ))}
                  {filteredMedia.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm text-slate-500">
                      本地数据中无匹配项
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200/90 bg-white/95">
              <CardHeader>
                <CardTitle className="text-base">我的模拟求片记录</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {sessionRequests.length === 0 ? (
                  <p className="text-sm text-slate-500">暂无求片记录</p>
                ) : (
                  sessionRequests.slice(0, 8).map((req) => (
                    <div
                      key={req.id}
                      className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
                    >
                      <div>
                        <p>{req.title}</p>
                        <p className="text-xs text-slate-500">{new Date(req.createdAt).toLocaleString()}</p>
                      </div>
                      <Badge variant="secondary">{REQUEST_STATUS_TEXT[req.status]}</Badge>
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
                <CardDescription>签到、转账、兑换码和历史全部本地模拟。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">当前余额</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">{sessionAccount?.score ?? "-"}</p>
                </div>

                <Button onClick={() => void handleCheckin()} disabled={!sessionAccount || sessionAccount.checkedToday} className="w-full">
                  <Gift className="mr-2 h-4 w-4" />
                  {sessionAccount?.checkedToday ? "今日已签到" : "每日签到"}
                </Button>

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
                <Button variant="outline" onClick={() => void handleTransfer()}>
                  <Wallet className="mr-2 h-4 w-4" />
                  模拟转账
                </Button>

                <div className="space-y-2">
                  <Label>兑换码</Label>
                  <Input value={couponCode} onChange={(e) => setCouponCode(e.target.value)} placeholder="示例: SIM-2026-HELLO" />
                </div>
                <Button variant="outline" onClick={() => void handleRedeemCoupon()}>
                  兑换积分
                </Button>
              </CardContent>
            </Card>

            <Card className="border-slate-200/90 bg-white/95">
              <CardHeader>
                <CardTitle className="text-base">积分流水（最近 8 条）</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {sessionScoreHistory.length === 0 ? (
                  <p className="text-sm text-slate-500">暂无积分流水</p>
                ) : (
                  sessionScoreHistory.map((item) => (
                    <div key={item.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                      <div>
                        <p>{SCORE_ACTION_TEXT[item.type]}</p>
                        <p className="text-xs text-slate-500">{item.note}</p>
                      </div>
                      <div className={item.amount >= 0 ? "text-emerald-600" : "text-rose-600"}>
                        {item.amount >= 0 ? `+${item.amount}` : item.amount}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="profile" className="space-y-3">
            <Card className="border-slate-200/90 bg-white/95">
              <CardHeader>
                <CardTitle className="text-base">个人资料（本地会话）</CardTitle>
                <CardDescription>仅更新当前页面内存状态，不写入后端。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <Label>用户名</Label>
                  <Input value={profileName} onChange={(e) => setProfileName(e.target.value)} disabled={!sessionAccount} />
                </div>
                <div className="space-y-2">
                  <Label>邮箱</Label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <Input
                      value={profileEmail}
                      onChange={(e) => setProfileEmail(e.target.value)}
                      className="pl-9"
                      disabled={!sessionAccount}
                    />
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  角色: {sessionAccount?.roleName ?? "-"} · TG 绑定: {sessionAccount?.tgBound ? "是" : "否"} · Emby 绑定: {sessionAccount?.embyBound ? "是" : "否"}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    disabled={!sessionAccount}
                    onClick={() => {
                      if (!sessionAccount) return;
                      updateAccount(sessionAccount.uid, (acc) => ({ ...acc, tgBound: !acc.tgBound }));
                      setNotice("已切换 TG 绑定状态（本地模拟）。");
                    }}
                  >
                    <Bot className="mr-2 h-4 w-4" />
                    切换 TG
                  </Button>
                  <Button disabled={!sessionAccount} onClick={() => void handleSaveProfile()}>
                    保存资料
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200/90 bg-white/95">
              <CardHeader>
                <CardTitle className="text-base">本地用户清单</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {accounts.slice(0, 6).map((item) => (
                  <div key={item.uid} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    <div>
                      <p>{item.username}</p>
                      <p className="text-xs text-slate-500">UID {item.uid} · {item.email}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      {item.embyBound ? <Badge variant="secondary">Emby</Badge> : null}
                      {item.uid === sessionUid ? <Badge>当前</Badge> : null}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <nav className="sticky bottom-2 rounded-2xl border border-slate-200 bg-white/95 p-2 shadow-sm backdrop-blur">
          <ul className="grid grid-cols-5 gap-1">
            <li>
              <button className={navItemClass("home")} onClick={() => setActiveTab("home")}>
                <Home className="h-4 w-4" />
                首页
              </button>
            </li>
            <li>
              <button className={navItemClass("auth")} onClick={() => setActiveTab("auth")}>
                <ShieldCheck className="h-4 w-4" />
                账号
              </button>
            </li>
            <li>
              <button className={navItemClass("media")} onClick={() => setActiveTab("media")}>
                <Compass className="h-4 w-4" />
                求片
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

        <div className="rounded-2xl border border-slate-200 bg-white/90 p-3 text-xs text-slate-600">
          <p className="flex items-center gap-2 font-medium text-slate-700">
            <ListChecks className="h-4 w-4" />
            模拟页一致性说明
          </p>
          <ul className="mt-2 space-y-1">
            <li>1. 注册流程区分系统账号与 Emby 账号，Emby 走队列并支持状态轮询。</li>
            <li>2. 媒体、积分、资料模块采用本地状态机模拟接口返回。</li>
            <li>3. 页面不发起任何后端请求，适用于离线演练和安全测试。</li>
          </ul>
        </div>

        {loadingLabel ? (
          <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-slate-900/25 backdrop-blur-[1px]">
            <div className="rounded-xl bg-white px-4 py-3 text-sm text-slate-700 shadow-lg">
              <Loader2 className="mr-2 inline-block h-4 w-4 animate-spin" />
              {loadingLabel}...
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
