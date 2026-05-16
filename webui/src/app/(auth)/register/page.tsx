"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Eye, EyeOff, ArrowRight, Loader2, ShieldPlus, UserPlus, Clock3, Bot, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { api, type EmbyRegisterStatus, type RegisterAvailability, type RegisterData } from "@/lib/api";
import { SITE_NAME } from "@/lib/site-config";
import { useAuthStore } from "@/store/auth";
import { useSystemStore } from "@/store/system";
import { passwordStrengthLabel, validatePasswordStrength } from "@/lib/password";

type RegisterTarget = "system" | "emby";

const QUEUE_STATUS_TEXT: Record<NonNullable<EmbyRegisterStatus["status"]>, string> = {
  queued: "排队中",
  processing: "处理中",
  success: "注册成功",
  failed: "注册失败",
};

export default function RegisterPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { login } = useAuthStore();
  const { info: systemInfo, fetchInfo: fetchSystemInfo } = useSystemStore();

  const [activeTab, setActiveTab] = useState<string>("register");
  const [registerTarget, setRegisterTarget] = useState<RegisterTarget>("system");

  const [formData, setFormData] = useState({
    username: "",
    password: "",
    confirmPassword: "",
    email: "",
    regCode: "",
  });

  const [registerAvailability, setRegisterAvailability] = useState<RegisterAvailability | null>(null);
  const [bindCode, setBindCode] = useState("");
  const [bindCodeExpiry, setBindCodeExpiry] = useState(0);
  const [bindConfirmed, setBindConfirmed] = useState(false);

  const [isRegisterLoading, setIsRegisterLoading] = useState(false);
  const [isBindCodeLoading, setIsBindCodeLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [queueTicket, setQueueTicket] = useState<{ requestId: string; statusToken: string } | null>(null);
  const [embyQueueStatus, setEmbyQueueStatus] = useState<EmbyRegisterStatus | null>(null);
  const [queuePolling, setQueuePolling] = useState(false);

  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  useEffect(() => {
    void fetchSystemInfo();
    void refreshRegisterAvailability();
  }, [fetchSystemInfo]);

  const forceBindTelegram = Boolean(systemInfo?.features?.force_bind_telegram);
  const embyDirectRegisterEnabled = Boolean(
    systemInfo?.features?.emby_direct_register || registerAvailability?.emby_direct_register_enabled
  );

  const embyRegisterBlockedReason = useMemo(() => {
    if (!embyDirectRegisterEnabled) {
      return "管理员尚未开启 Emby 自由注册";
    }
    if (registerAvailability && !registerAvailability.available) {
      return registerAvailability.message || "当前已达到注册上限";
    }
    return "";
  }, [embyDirectRegisterEnabled, registerAvailability]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const refreshRegisterAvailability = async () => {
    try {
      const res = await api.getRegisterAvailability();
      if (res.success && res.data) {
        setRegisterAvailability(res.data);
      }
    } catch {
      // ignore, use fallback UI
    }
  };

  const handleGetTelegramBindCode = async () => {
    setIsBindCodeLoading(true);
    try {
      const res = await api.getRegisterBindCode();
      setBindCode(res.data?.bind_code || "");
      setBindCodeExpiry(res.data?.expires_in ?? 0);
      setBindConfirmed(false);
      toast({
        title: "已生成绑定码",
        description: "请在 Telegram Bot 私聊中发送 /bind <绑定码> 完成验证",
        variant: "success",
      });
    } catch (error: any) {
      toast({
        title: "获取绑定码失败",
        description: error.message || "请检查 API 服务可达性（如 522 源站超时）与 Telegram Bot 配置",
        variant: "destructive",
      });
    } finally {
      setIsBindCodeLoading(false);
    }
  };

  // 拿到绑定码后开始轮询，直到 Bot 端确认或绑定码过期。
  useEffect(() => {
    if (!bindCode || bindConfirmed) return;

    let cancelled = false;
    let toastedConfirmed = false;
    const controller = new AbortController();

    const tick = async () => {
      try {
        const res = await api.getRegisterBindCodeStatus(bindCode, controller.signal);
        if (cancelled) return;
        if (res.success && res.data) {
          if (typeof res.data.expires_in === "number") {
            setBindCodeExpiry(res.data.expires_in);
          }
          if (res.data.confirmed && !toastedConfirmed) {
            toastedConfirmed = true;
            setBindConfirmed(true);
            toast({
              title: "Telegram 绑定成功",
              description: "点击下方「注册」按钮即可进入系统",
              variant: "success",
            });
          }
        } else if (res.message && /无效|过期/.test(res.message)) {
          // 后端把过期/无效都返回 404；视作过期，清空绑定码让用户重新生成。
          if (!cancelled) {
            setBindCode("");
            setBindCodeExpiry(0);
            setBindConfirmed(false);
            toast({
              title: "绑定码已过期",
              description: "请重新获取绑定码",
              variant: "destructive",
            });
          }
        }
      } catch {
        // 静默重试，避免污染 toast
      }
    };

    // 立即先跑一次，之后每 2 秒一次
    void tick();
    const handle = window.setInterval(tick, 2000);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(handle);
    };
  }, [bindCode, bindConfirmed, toast]);

  const pollEmbyQueueStatus = async (ticket = queueTicket) => {
    if (!ticket) return;

    setQueuePolling(true);
    try {
      const res = await api.getEmbyRegisterStatus(ticket.requestId, ticket.statusToken);
      if (!res.success || !res.data) return;

      const nextStatus = res.data;
      const prevStatus = embyQueueStatus?.status;
      setEmbyQueueStatus(nextStatus);

      if (nextStatus.status === "success" && prevStatus !== "success") {
        const generatedPassword = nextStatus.data?.emby_password;
        setLoginUsername(nextStatus.data?.username || formData.username);
        if (generatedPassword) {
          setLoginPassword(generatedPassword);
        }

        toast({
          title: "Emby 账号注册成功",
          description: generatedPassword
            ? "已返回 Emby 密码，请立即保存"
            : "账号已创建，可以直接使用你填写的密码登录",
          variant: "success",
        });
      }

      if (nextStatus.status === "failed" && prevStatus !== "failed") {
        toast({
          title: "Emby 注册失败",
          description: nextStatus.message || "请稍后重试",
          variant: "destructive",
        });
      }
    } catch {
      // polling errors are ignored to avoid noisy toasts
    } finally {
      setQueuePolling(false);
    }
  };

  useEffect(() => {
    if (!queueTicket) return;
    if (embyQueueStatus?.status === "success" || embyQueueStatus?.status === "failed") return;

    void pollEmbyQueueStatus(queueTicket);
    const timer = window.setInterval(() => {
      void pollEmbyQueueStatus(queueTicket);
    }, 2000);

    return () => {
      window.clearInterval(timer);
    };
  }, [queueTicket, embyQueueStatus?.status]);

  const validateRegisterForm = (): boolean => {
    if (!formData.username) {
      toast({ title: "请填写用户名", variant: "destructive" });
      return false;
    }

    if (registerTarget === "system" && !formData.password) {
      toast({ title: "系统账号注册必须设置密码", variant: "destructive" });
      return false;
    }

    if (formData.password) {
      if (formData.password !== formData.confirmPassword) {
        toast({ title: "密码不一致", description: "请确认两次输入的密码相同", variant: "destructive" });
        return false;
      }

      const strength = validatePasswordStrength(formData.password, "密码");
      if (!strength.ok) {
        toast({ title: "密码强度不足", description: strength.message, variant: "destructive" });
        return false;
      }
    }

    if ((forceBindTelegram || registerTarget === "emby") && !bindCode) {
      toast({
        title: "请先完成 Telegram 绑定验证",
        description: "点击获取绑定码后，在 Bot 私聊发送 /bind <绑定码>",
        variant: "destructive",
      });
      return false;
    }

    if ((forceBindTelegram || registerTarget === "emby") && bindCode && !bindConfirmed) {
      toast({
        title: "请先在 Telegram 完成绑定验证",
        description: `请去 Bot 私聊发送 /bind ${bindCode}`,
        variant: "destructive",
      });
      return false;
    }

    if (registerTarget === "emby" && embyRegisterBlockedReason) {
      toast({
        title: "当前无法进行 Emby 账号注册",
        description: embyRegisterBlockedReason,
        variant: "destructive",
      });
      return false;
    }

    return true;
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateRegisterForm()) {
      return;
    }

    setIsRegisterLoading(true);
    try {
      const payload: RegisterData = {
        username: formData.username,
        email: formData.email || undefined,
        telegram_bind_code: bindCode || undefined,
        registration_target: registerTarget,
      };

      if (formData.password) {
        payload.password = formData.password;
      }

      if (registerTarget === "system" && formData.regCode) {
        payload.reg_code = formData.regCode;
      }

      const res = await api.register(payload);

      if (!res.success) {
        toast({ title: "注册失败", description: res.message, variant: "destructive" });
        return;
      }

      if (registerTarget === "emby") {
        const requestId = res.data?.request_id;
        const statusToken = res.data?.status_token;

        if (!requestId || !statusToken) {
          toast({ title: "注册受理失败", description: "未获取到队列凭证", variant: "destructive" });
          return;
        }

        setQueueTicket({ requestId, statusToken });
        setEmbyQueueStatus({
          request_id: requestId,
          status: res.data?.status || "queued",
          queue_position: res.data?.queue_position,
          message: res.message,
        });

        toast({
          title: res.data?.reused ? "已复用已有注册请求" : "已进入 Emby 注册队列",
          description: "系统将自动轮询进度，请稍候",
          variant: "success",
        });
        return;
      }

      toast({
        title: "系统账号注册成功",
        description: "请使用系统账号登录网页端",
        variant: "success",
      });
      router.push("/login");
    } catch (error: any) {
      toast({
        title: "注册失败",
        description: error.message || "请检查网络连接",
        variant: "destructive",
      });
    } finally {
      setIsRegisterLoading(false);
      void refreshRegisterAvailability();
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!loginUsername || !loginPassword) {
      toast({
        title: "请填写完整信息",
        variant: "destructive",
      });
      return;
    }

    setLoginLoading(true);
    try {
      const result = await login(loginUsername, loginPassword);
      if (result.ok) {
        toast({
          title: "登录成功",
          description: "欢迎回来！",
          variant: "success",
        });
        router.replace("/dashboard");
      } else {
        const message = result.message || "用户名或密码错误";
        const disabled = /禁用/.test(message);
        toast({
          title: disabled ? "账户已被禁用" : "登录失败",
          description: disabled ? "请联系管理员处理" : message,
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "登录失败",
        description: error.message || "请检查网络连接",
        variant: "destructive",
      });
    } finally {
      setLoginLoading(false);
    }
  };

  return (
    <main className="relative flex min-h-screen w-full items-center justify-center p-4">
      <div className="absolute left-4 top-4 z-30">
        <Button asChild variant="secondary" size="sm" className="shadow-sm">
          <Link href="/login">
            <ArrowLeft className="mr-2 h-4 w-4" />
            返回登录页
          </Link>
        </Button>
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="relative z-10 w-full max-w-[1100px]"
      >
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <Card className="grid gap-6 overflow-hidden border-border/70 bg-card/78 shadow-2xl backdrop-blur-xl lg:grid-cols-[300px_minmax(0,1fr)]">
            <div className="space-y-6 border-b border-border/70 p-6 lg:border-b-0 lg:border-r lg:p-8">
              <div className="space-y-2">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/14 text-primary">
                  <ShieldPlus className="h-7 w-7" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold">欢迎来到 {systemInfo?.name || SITE_NAME}</h2>
                  <p className="text-sm text-muted-foreground">
                    系统账号用于网页登录与个人设置；Emby 账号用于媒体播放，两者注册入口已分离。
                  </p>
                </div>
              </div>

              <div className="w-full">
                <TabsList className="grid grid-cols-2 gap-2 lg:grid-cols-1">
                  <TabsTrigger value="register" className="rounded-2xl py-3 font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                    注册
                  </TabsTrigger>
                  <TabsTrigger value="login" className="rounded-2xl py-3 font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                    登录
                  </TabsTrigger>
                </TabsList>
              </div>

              <div className="rounded-2xl border border-border/70 bg-muted/40 p-4 text-sm text-muted-foreground">
                <p className="font-semibold text-foreground">Telegram 绑定说明</p>
                <p className="mt-2 leading-relaxed">
                  点击“获取绑定码”，在 Bot 私聊中发送 /bind &lt;绑定码&gt; 完成验证。
                  Emby 账号注册始终要求先完成这一步。
                </p>
                {systemInfo?.telegram_bot?.username ? (
                  <p className="mt-2 inline-flex items-center gap-1.5 text-xs">
                    <Bot className="h-3.5 w-3.5" />
                    <span>绑定 Bot：</span>
                    <a
                      href={systemInfo.telegram_bot.url ?? `https://t.me/${systemInfo.telegram_bot.username}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-primary hover:underline"
                    >
                      @{systemInfo.telegram_bot.username}
                    </a>
                  </p>
                ) : null}
                {registerAvailability ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    当前注册配额: {registerAvailability.current_users} / {registerAvailability.max_users}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="p-6 sm:p-8">
              <TabsContent value="register" className="space-y-6">
                <div className="space-y-3">
                  <CardTitle className="text-2xl font-semibold tracking-tight">创建账号</CardTitle>
                  <Tabs value={registerTarget} onValueChange={(v) => setRegisterTarget(v as RegisterTarget)} className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="system">系统账号注册</TabsTrigger>
                      <TabsTrigger value="emby" disabled={!embyDirectRegisterEnabled}>
                        Emby 账号注册
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="system" className="mt-3 rounded-xl border border-border/70 bg-muted/30 p-3 text-sm text-muted-foreground">
                      系统账号用于登录 {SITE_NAME} 网页端、管理个人设置、绑定信息等，不会自动创建 Emby 账号。
                    </TabsContent>
                    <TabsContent value="emby" className="mt-3 rounded-xl border border-border/70 bg-muted/30 p-3 text-sm text-muted-foreground">
                      Emby 账号注册会进入安全队列，系统完成 TG 绑定校验与人数上限校验后再创建账号。
                    </TabsContent>
                  </Tabs>

                  <div className="rounded-xl border border-border/70 bg-muted/20 p-3 text-xs text-muted-foreground">
                    Emby 自由注册状态: {embyDirectRegisterEnabled ? "已开启" : "未开启"}
                    {embyRegisterBlockedReason ? `（${embyRegisterBlockedReason}）` : ""}
                  </div>
                </div>

                <form onSubmit={handleRegisterSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="username" className="ml-1">用户名 *</Label>
                      <Input
                        id="username"
                        name="username"
                        placeholder="Username"
                        value={formData.username}
                        onChange={handleChange}
                        className="h-11"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email" className="ml-1">邮箱</Label>
                      <Input
                        id="email"
                        name="email"
                        type="email"
                        placeholder="Email (Optional)"
                        value={formData.email}
                        onChange={handleChange}
                        className="h-11"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="password" className="ml-1">
                        {registerTarget === "system" ? "设置密码 *" : "设置密码（可选）"}
                      </Label>
                      <div className="relative">
                        <Input
                          id="password"
                          name="password"
                          type={showPassword ? "text" : "password"}
                          placeholder={registerTarget === "system" ? "至少 8 位，含大小写字母和数字" : "留空则自动生成密码"}
                          value={formData.password}
                          onChange={handleChange}
                          className="h-11 pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      {formData.password && (() => {
                        const s = validatePasswordStrength(formData.password, "密码");
                        return (
                          <p className={`text-xs ${s.ok ? passwordStrengthLabel(s.score).className : "text-destructive"}`}>
                            {s.ok ? `强度：${passwordStrengthLabel(s.score).label}` : s.message}
                          </p>
                        );
                      })()}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="confirmPassword" className="ml-1">
                        {registerTarget === "system" ? "确认密码 *" : "确认密码（可选）"}
                      </Label>
                      <Input
                        id="confirmPassword"
                        name="confirmPassword"
                        type="password"
                        placeholder="Confirm Password"
                        value={formData.confirmPassword}
                        onChange={handleChange}
                        className="h-11"
                      />
                    </div>
                  </div>

                  {registerTarget === "system" ? (
                    <div className="space-y-2">
                      <Label htmlFor="regCode" className="ml-1 text-xs">注册码 / 邀请码（系统账号）</Label>
                      <Input
                        id="regCode"
                        name="regCode"
                        placeholder="Registration Code"
                        value={formData.regCode}
                        onChange={handleChange}
                        className="h-11"
                      />
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    <Label className="ml-1">Telegram 绑定</Label>
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      <p className="font-medium">请先在 Telegram 中打开服务 Bot 的私聊窗口。</p>
                      <p className="mt-1 leading-relaxed">
                        点击“获取绑定码”后，在 Bot 私聊中发送 /bind &lt;绑定码&gt; 完成验证。
                      </p>
                      {systemInfo?.telegram_bot?.username ? (
                        <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-amber-900">
                          <Bot className="h-3.5 w-3.5" />
                          <span>本站 Bot：</span>
                          <a
                            href={systemInfo.telegram_bot.url ?? `https://t.me/${systemInfo.telegram_bot.username}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium underline-offset-2 hover:underline"
                          >
                            @{systemInfo.telegram_bot.username}
                          </a>
                        </p>
                      ) : (
                        <p className="mt-2 text-xs text-amber-700">
                          管理员尚未配置可识别的 Bot 账号，如无法获取绑定码请联系管理员。
                        </p>
                      )}
                      <p className="mt-2 text-xs text-amber-700">
                        Emby 账号注册默认强制验证 Telegram 绑定，防止冒用注册。
                      </p>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
                      <Button
                        type="button"
                        onClick={handleGetTelegramBindCode}
                        disabled={isBindCodeLoading}
                      >
                        {isBindCodeLoading ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <ShieldPlus className="mr-2 h-4 w-4" />
                        )}
                        获取绑定码
                      </Button>
                      {systemInfo?.telegram_bot?.url ? (
                        <Button
                          asChild
                          type="button"
                          variant="outline"
                        >
                          <a
                            href={systemInfo.telegram_bot.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Bot className="mr-2 h-4 w-4" />
                            打开 @{systemInfo.telegram_bot.username}
                          </a>
                        </Button>
                      ) : null}
                      {bindCode && !bindConfirmed ? (
                        <div className="rounded-lg border border-border/70 bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                          <p>请到 Bot 私聊发送：</p>
                          <p className="font-mono text-base text-foreground">/bind {bindCode}</p>
                          <p className="flex items-center gap-1 text-xs">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            等待 Bot 端验证…（剩余 {Math.max(0, Math.floor(bindCodeExpiry / 60))} 分钟）
                          </p>
                        </div>
                      ) : null}
                      {bindCode && bindConfirmed ? (
                        <div className="rounded-lg border border-emerald-300/60 bg-emerald-50 px-3 py-2 text-sm dark:border-emerald-700/60 dark:bg-emerald-900/30">
                          <p className="font-semibold text-emerald-700 dark:text-emerald-300">
                            ✅ Telegram 绑定成功
                          </p>
                          <p className="text-xs text-emerald-700/80 dark:text-emerald-300/80">
                            点击下方「注册」按钮即可进入系统。
                          </p>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="pt-2">
                    <Button
                      type="submit"
                      className="h-11 w-full"
                      disabled={
                        isRegisterLoading ||
                        (registerTarget === "emby" && !!embyRegisterBlockedReason) ||
                        ((forceBindTelegram || registerTarget === "emby") && !!bindCode && !bindConfirmed)
                      }
                    >
                      {isRegisterLoading ? (
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      ) : (
                        <UserPlus className="mr-2 h-5 w-5" />
                      )}
                      {registerTarget === "system" ? "注册系统账号" : "提交 Emby 注册队列"}
                    </Button>
                  </div>

                  <div className="pt-1 text-center">
                    <Button asChild variant="link" className="h-auto px-1 text-sm">
                      <Link href="/login">已有账号？返回登录页</Link>
                    </Button>
                  </div>
                </form>

                {queueTicket && embyQueueStatus ? (
                  <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-foreground">Emby 注册队列状态</p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={queuePolling}
                        onClick={() => void pollEmbyQueueStatus()}
                      >
                        {queuePolling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Clock3 className="mr-2 h-4 w-4" />}
                        刷新状态
                      </Button>
                    </div>

                    <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                      <p>请求编号: {queueTicket.requestId}</p>
                      <p>当前状态: {QUEUE_STATUS_TEXT[embyQueueStatus.status]}</p>
                      {typeof embyQueueStatus.queue_position === "number" ? (
                        <p>当前排队位置: {embyQueueStatus.queue_position}</p>
                      ) : null}
                      {embyQueueStatus.message ? <p>说明: {embyQueueStatus.message}</p> : null}
                    </div>

                    {embyQueueStatus.status === "success" ? (
                      <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                        <p className="font-medium">Emby 账号已创建</p>
                        <p className="mt-1">用户名: {embyQueueStatus.data?.username || formData.username}</p>
                        {embyQueueStatus.data?.emby_password ? (
                          <p className="mt-1">密码: <span className="font-mono">{embyQueueStatus.data.emby_password}</span></p>
                        ) : (
                          <p className="mt-1">密码: 使用你注册时填写的密码</p>
                        )}
                        <Button
                          type="button"
                          className="mt-3"
                          onClick={() => setActiveTab("login")}
                        >
                          <Bot className="mr-2 h-4 w-4" />
                          前往登录
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </TabsContent>

              <TabsContent value="login" className="space-y-6">
                <div className="space-y-2 text-center">
                  <CardTitle className="text-2xl font-semibold tracking-tight">已有账号</CardTitle>
                  <CardDescription className="text-sm text-muted-foreground">
                    使用系统账号登录网页端。
                  </CardDescription>
                </div>

                <form onSubmit={handleLoginSubmit} className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="loginUsername" className="ml-1">用户名</Label>
                    <Input
                      id="loginUsername"
                      placeholder="Username"
                      value={loginUsername}
                      onChange={(e) => setLoginUsername(e.target.value)}
                      className="h-11"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="loginPassword" className="ml-1">密码</Label>
                    <div className="relative">
                      <Input
                        id="loginPassword"
                        type={showPassword ? "text" : "password"}
                        placeholder="Password"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        className="h-11 pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="pt-2">
                    <Button
                      type="submit"
                      className="h-11 w-full"
                      disabled={loginLoading}
                    >
                      {loginLoading ? (
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      ) : (
                        <ArrowRight className="mr-2 h-5 w-5" />
                      )}
                      立即登录
                    </Button>
                  </div>
                </form>
              </TabsContent>
            </div>
          </Card>
        </Tabs>
      </motion.div>
    </main>
  );
}
