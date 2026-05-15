"use client";

import { motion } from "framer-motion";
import { Megaphone } from "lucide-react";
import { AnnouncementBoard } from "@/components/announcement-board";

export default function UserAnnouncementsPage() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Megaphone className="h-5 w-5" />
          全站公告
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          管理员发布的全部公告与历史记录，按置顶与发布时间排序。
        </p>
      </div>

      <AnnouncementBoard
        title={null}
        limit={200}
        collapseAfter={200}
        showEmptyState
      />
    </motion.div>
  );
}
