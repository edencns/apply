"use client";

import { useState, useEffect } from "react";
import { sitesApi, customersApi } from "@/lib/api";
import Link from "next/link";
import {
  Building2, Users, FileText, CheckCircle, XCircle, Clock,
  TrendingUp, AlertTriangle,
} from "lucide-react";

interface DashboardStats {
  totalCustomers: number;
  winners: number;
  eligible: number;
  ineligible: number;
  needsReview: number;
  contracted: number;
}

export default function DashboardPage() {
  const [sites, setSites] = useState<any[]>([]);
  const [selectedSite, setSelectedSite] = useState<number | null>(null);
  const [stats, setStats] = useState<DashboardStats>({
    totalCustomers: 0, winners: 0, eligible: 0,
    ineligible: 0, needsReview: 0, contracted: 0,
  });

  useEffect(() => {
    sitesApi.list().then((res) => {
      setSites(res.data);
      if (res.data.length > 0) setSelectedSite(res.data[0].id);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedSite) return;
    Promise.all([
      customersApi.list(selectedSite),
      customersApi.list(selectedSite, "winner"),
      customersApi.list(selectedSite, "contracted"),
    ]).then(([all, winners, contracted]) => {
      setStats({
        totalCustomers: all.data.length,
        winners: winners.data.length,
        eligible: 0,
        ineligible: 0,
        needsReview: 0,
        contracted: contracted.data.length,
      });
    }).catch(() => {});
  }, [selectedSite]);

  const statCards = [
    { label: "전체 고객", value: stats.totalCustomers, icon: Users, color: "blue" },
    { label: "당첨자", value: stats.winners, icon: TrendingUp, color: "purple" },
    { label: "서류 검수 완료", value: stats.eligible, icon: CheckCircle, color: "green" },
    { label: "부적격", value: stats.ineligible, icon: XCircle, color: "red" },
    { label: "확인 필요", value: stats.needsReview, icon: AlertTriangle, color: "yellow" },
    { label: "계약 완료", value: stats.contracted, icon: FileText, color: "indigo" },
  ];

  const colorMap: Record<string, string> = {
    blue: "bg-blue-50 text-blue-600",
    purple: "bg-purple-50 text-purple-600",
    green: "bg-green-50 text-green-600",
    red: "bg-red-50 text-red-600",
    yellow: "bg-yellow-50 text-yellow-600",
    indigo: "bg-indigo-50 text-indigo-600",
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">분양 자동화 시스템</h1>
          <p className="text-sm text-gray-500 mt-1">현장 현황 대시보드</p>
        </div>
        <select
          value={selectedSite || ""}
          onChange={(e) => setSelectedSite(Number(e.target.value))}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {sites.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        {statCards.map((card) => (
          <div key={card.label} className="card">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${colorMap[card.color]}`}>
              <card.icon className="w-5 h-5" />
            </div>
            <div className="text-2xl font-bold text-gray-900">{card.value.toLocaleString()}</div>
            <div className="text-xs text-gray-500 mt-1">{card.label}</div>
          </div>
        ))}
      </div>

      {/* 빠른 메뉴 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Link href="/workflow/registration" className="card hover:shadow-md transition-shadow cursor-pointer group">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
              <Users className="w-5 h-5 text-blue-600" />
            </div>
            <span className="font-semibold text-gray-800 group-hover:text-blue-600">당첨자 등록</span>
          </div>
          <p className="text-sm text-gray-500">전산추첨결과·당첨자현황 PDF 업로드로 등록</p>
        </Link>

        <Link href="/workflow/documents" className="card hover:shadow-md transition-shadow cursor-pointer group">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center">
              <FileText className="w-5 h-5 text-green-600" />
            </div>
            <span className="font-semibold text-gray-800 group-hover:text-green-600">서류·판정</span>
          </div>
          <p className="text-sm text-gray-500">공급유형별 서류 체크 + 적합 판정</p>
        </Link>

        <Link href="/contracts/walk-in" className="card hover:shadow-md transition-shadow cursor-pointer group">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center">
              <Building2 className="w-5 h-5 text-purple-600" />
            </div>
            <span className="font-semibold text-gray-800 group-hover:text-purple-600">방문 계약</span>
          </div>
          <p className="text-sm text-gray-500">성명+주민번호로 계약서 즉시 호출</p>
        </Link>

        <Link href="/announcements" className="card hover:shadow-md transition-shadow cursor-pointer group">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-orange-50 rounded-lg flex items-center justify-center">
              <Clock className="w-5 h-5 text-orange-600" />
            </div>
            <span className="font-semibold text-gray-800 group-hover:text-orange-600">모집공고 관리</span>
          </div>
          <p className="text-sm text-gray-500">공고 등록 및 자격 기준 설정</p>
        </Link>
      </div>
    </div>
  );
}
