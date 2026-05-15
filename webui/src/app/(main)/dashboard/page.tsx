"use client";

import { useCallback, useState } from "react";
import { motion } from "framer-motion";
import { Calendar, Clock, Eye, EyeOff, Gift, Key, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { PageError } from "@/components/layout/page-state";
import { useAuthStore } from "@/store/auth";
import { api } from "@/lib/api";
import { AnnouncementBoard } from "@/components/announcement-board";

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
    },
  },
};

const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0 },
};

export default function DashboardPage() {
  const { user, fetchUser } = useAuthStore();
  const { toast } = useToast();
  const [regCode, setRegCode] = useState("");
  const [regCodeInfo, setRegCodeInfo] = useState<{ type: number; type_name: string; days: number } | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isUsingCode, setIsUsingCode] = useState(false);
  const [embyUsername, setEmbyUsername] = useState("");
  const [embyPassword, setEmbyPassword] = useState("");
  const [showEmbyPassword, setShowEmbyPassword] = useState(false);

  const loadDashboardData = useCallback(async () => true, []);

  const {
    isLoading,
    error,
  } = useAsyncResource(loadDashboardData, { immediate: true });

  const isAdmin = user?.role === 0;
  const isPending = !user?.emby_id && !user?.active;

  let expiredTimestamp: number | null = null;
  if (user?.expired_at) {
    if (typeof user.expired_at === "number") {
      if (user.expired_at !== -1) {
        expiredTimestamp = user.expired_at < 10000000000 ? user.expired_at * 1000 : user.expired_at;
      }
    } else if (typeof user.expired_at === "string" && user.expired_at !== "-1") {
      const parsed = new Date(user.expired_at).getTime();
      expiredTimestamp = Number.isNaN(parsed) ? null : parsed;
    }
  }

  const isPermanent = isAdmin || expiredTimestamp === null;
  const safeExpiredTimestamp = expiredTimestamp ?? 0;
  const isExpired = !isPermanent && safeExpiredTimestamp < Date.now();
  const daysLeft = !isPermanent ? Math.max(0, Math.ceil((safeExpiredTimestamp - Date.now()) / (1000 * 60 * 60 * 24))) : 0;

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 6) return "凌晨好";
    if (hour < 9) return "早上好";
    if (hour < 12) return "上午好";
    if (hour < 14) return "中午好";
    if (hour < 18) return "下午好";
    if (hour < 22) return "晚上好";
    return "夜深了";
  };

  const handleCheckRegcode = async () => {
    if (!regCode.trim()) {
      toast({ title: "请输入注册码/续期码", variant: "destructive" });
      return;
    }

    try {
      const res = await api.checkRegcode(regCode.trim());
      if (res.success && res.data) {
        setRegCodeInfo(res.data);
        setEmbyUsername("");
        setEmbyPassword("");
        setShowEmbyPassword(false);
        setShowConfirm(true);
      } else {
        toast({ title: "注册码/续期码无效", description: res.message, variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "检查失败", description: err.message || "网络异常", variant: "destructive" });
    }
  };

  const handleUseRegcode = async () => {
    if (!regCodeInfo || !regCode.trim()) return;

    const requiresEmbyRegister = !user?.emby_id && (regCodeInfo.type === 1 || regCodeInfo.type === 3);

    const validateEmbyPassword = (pwd: string) => {
      if (pwd.length < 8) return "Emby 密码至少 8 位";
      if (!/[a-z]/.test(pwd)) return "Emby 密码至少包含一个小写字母";
      if (!/[A-Z]/.test(pwd)) return "Emby 密码至少包含一个大写字母";
      if (!/\d/.test(pwd)) return "Emby 密码至少包含一个数字";
      return "";
    };

    if (requiresEmbyRegister) {
      if (!embyUsername.trim()) {
        toast({ title: "请输入 Emby 用户名", variant: "destructive" });
        return;
      }
      const pwdErr = validateEmbyPassword(embyPassword);
      if (pwdErr) {
        toast({ title: "Emby 密码强度不足", description: pwdErr, variant: "destructive" });
        return;
      }
    }

    setIsUsingCode(true);
    try {
      const res = await api.useCode(
        regCode.trim(),
        requiresEmbyRegister
          ? { embyUsername: embyUsername.trim(), embyPassword }
          : undefined
      );
      if (res.success) {
        toast({ title: "注册码/续期码使用成功", description: regCodeInfo.type_name, variant: "success" });
        setRegCode("");
        setRegCodeInfo(null);
        setShowConfirm(false);
        setEmbyUsername("");
        setEmbyPassword("");
        await fetchUser();
      } else {
        toast({ title: "使用失败", description: res.message, variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "使用失败", description: err.message || "网络异常", variant: "destructive" });
    } finally {
      setIsUsingCode(false);
    }
  };

  if (error) {
    return <PageError message={error} />;
  }

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-6 pb-10">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-black tracking-tighter">{getGreeting()}，{user?.username}</h1>
          <p className="text-muted-foreground font-medium mt-1">
            {isPending ? "当前账号可登录，若需媒体服务请联系管理员开通 Emby 账号" : "欢迎回来，当前账号状态正常"}
          </p>
        </div>
        <Badge className="bg-primary/10 text-primary border-primary/20 px-4 py-1.5 rounded-full font-black text-xs uppercase tracking-widest w-fit">
          {user?.role_name}
        </Badge>
      </div>

      <motion.div variants={item}>
        <AnnouncementBoard />
      </motion.div>

      <div className="grid gap-6 md:grid-cols-3">
        <motion.div variants={item} className="premium-card p-6">
          <div className="p-3 w-fit bg-amber-500/10 text-amber-500 rounded-2xl">
            <Calendar className="h-5 w-5" />
          </div>
          <p className="mt-6 text-[10px] font-black uppercase tracking-widest text-muted-foreground">到期倒计时</p>
          <h3 className="text-3xl font-black mt-1">
            {isPermanent ? "∞ 永久" : `${daysLeft} 天`}
          </h3>
        </motion.div>

        <motion.div variants={item} className="premium-card p-6">
          <div className="p-3 w-fit bg-purple-500/10 text-purple-500 rounded-2xl">
            <Clock className="h-5 w-5" />
          </div>
          <p className="mt-6 text-[10px] font-black uppercase tracking-widest text-muted-foreground">账号状态</p>
          <h3 className="text-3xl font-black mt-1">
            {isPending ? "待开通 Emby" : isExpired ? "已过期" : "正常"}
          </h3>
        </motion.div>

        <motion.div variants={item} className="premium-card p-6">
          <div className="p-3 w-fit bg-emerald-500/10 text-emerald-500 rounded-2xl">
            <Gift className="h-5 w-5" />
          </div>
          <p className="mt-6 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Emby 绑定</p>
          <h3 className="text-3xl font-black mt-1">{user?.emby_id ? "已绑定" : "未绑定"}</h3>
        </motion.div>
      </div>

      <motion.div variants={item} className="premium-card p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2 bg-primary/10 rounded-xl text-primary">
            <Key className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-black tracking-tight">注册码/续期码使用</h3>
            <p className="text-[11px] text-muted-foreground font-bold uppercase tracking-tighter">Code Use</p>
          </div>
        </div>

        <div className="flex flex-col gap-3 md:flex-row">
          <Input
            placeholder="请输入注册码或续期码"
            value={regCode}
            onChange={(e) => setRegCode(e.target.value)}
            className="h-12 rounded-xl border-white/60 bg-white/40 shadow-inner"
          />
          <Button onClick={handleCheckRegcode} disabled={isLoading || isUsingCode} className="h-12 rounded-xl font-black">
            {isUsingCode ? <Loader2 className="h-4 w-4 animate-spin" /> : "验证并使用"}
          </Button>
        </div>
      </motion.div>

      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认使用注册码/续期码</DialogTitle>
          </DialogHeader>
          {regCodeInfo && (
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>类型: {regCodeInfo.type_name}</p>
              <p>
                {regCodeInfo.type === 2
                  ? regCodeInfo.days <= 0
                    ? "续期时长: 永久"
                    : `续期时长: ${regCodeInfo.days} 天`
                  : regCodeInfo.days <= 0
                    ? "有效期: 永久"
                    : `增加时长: ${regCodeInfo.days} 天`}
              </p>
            </div>
          )}
          {regCodeInfo && !user?.emby_id && (regCodeInfo.type === 1 || regCodeInfo.type === 3) && (
            <div className="space-y-3 rounded-lg border border-border p-3">
              <p className="text-sm font-medium">该卡码将创建 Emby 账号，请填写以下信息</p>
              <div className="space-y-2">
                <Label htmlFor="embyUsername">Emby 用户名</Label>
                <Input
                  id="embyUsername"
                  value={embyUsername}
                  onChange={(e) => setEmbyUsername(e.target.value)}
                  placeholder="请输入 Emby 用户名"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="embyPassword">Emby 密码</Label>
                <div className="relative">
                  <Input
                    id="embyPassword"
                    type={showEmbyPassword ? "text" : "password"}
                    value={embyPassword}
                    onChange={(e) => setEmbyPassword(e.target.value)}
                    placeholder="至少8位，含大小写字母和数字"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowEmbyPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showEmbyPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
          )}
          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={() => setShowConfirm(false)}>取消</Button>
            <Button onClick={handleUseRegcode} disabled={isUsingCode}>
              {isUsingCode ? <Loader2 className="h-4 w-4 animate-spin" /> : "确认"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
