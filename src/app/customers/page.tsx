"use client";

import { useEffect, useMemo, useState } from "react";
import {
  type CustomerProfile,
  type FollowUpTask,
  buildCustomerDirectory,
  buildFollowUpTasks,
  generateFollowUpWhatsAppUrl,
  markFollowUpStatus,
  updateCustomerMeta,
} from "@/lib/crm";
import { formatMoney } from "@/lib/orders";
import { todayIsoLocal } from "@/lib/brooder";
import { Card, Button, Input, Badge, EmptyState } from "@/components/ui";
import RequireAuth from "@/components/RequireAuth";

export default function CustomersPage() {
  const [customers, setCustomers] = useState<CustomerProfile[]>([]);
  const [followUps, setFollowUps] = useState<FollowUpTask[]>([]);
  const [search, setSearch] = useState("");
  const [selectedTag, setSelectedTag] = useState<string>("all");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerProfile | null>(null);
  const [editingNotes, setEditingNotes] = useState("");
  const [newTagInput, setNewTagInput] = useState("");
  const [activeTab, setActiveTab] = useState<"directory" | "followups">("directory");

  const today = todayIsoLocal();

  const loadData = () => {
    const list = buildCustomerDirectory();
    const tasks = buildFollowUpTasks();
    setCustomers(list);
    setFollowUps(tasks);
  };

  useEffect(() => {
    loadData();
  }, []);

  // Stats calculation
  const totalRevenue = useMemo(
    () => customers.reduce((sum, c) => sum + c.totalSpend, 0),
    [customers]
  );
  const repeatCount = useMemo(
    () => customers.filter((c) => c.totalOrdersCount > 1).length,
    [customers]
  );
  const repeatRate = customers.length
    ? Math.round((repeatCount / customers.length) * 100)
    : 0;
  const pendingFollowUps = useMemo(
    () => followUps.filter((f) => f.status === "pending"),
    [followUps]
  );
  const dueTodayFollowUps = useMemo(
    () => pendingFollowUps.filter((f) => f.dueDate <= today),
    [pendingFollowUps, today]
  );

  // Available tags
  const allTags = useMemo(() => {
    const set = new Set<string>();
    customers.forEach((c) => c.tags.forEach((t) => set.add(t)));
    return Array.from(set);
  }, [customers]);

  // Filtered customer list
  const filteredCustomers = useMemo(() => {
    return customers.filter((c) => {
      const matchSearch =
        search.trim() === "" ||
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.phone.includes(search) ||
        c.location.toLowerCase().includes(search.toLowerCase());

      const matchTag =
        selectedTag === "all" || c.tags.includes(selectedTag);

      return matchSearch && matchTag;
    });
  }, [customers, search, selectedTag]);

  const handleOpenDetail = (customer: CustomerProfile) => {
    setSelectedCustomer(customer);
    setEditingNotes(customer.notes || "");
  };

  const handleSaveNotes = () => {
    if (!selectedCustomer) return;
    updateCustomerMeta(selectedCustomer.id, { notes: editingNotes });
    setSelectedCustomer((prev) => (prev ? { ...prev, notes: editingNotes } : null));
    loadData();
  };

  const handleAddTag = () => {
    if (!selectedCustomer || !newTagInput.trim()) return;
    const tag = newTagInput.trim();
    if (!selectedCustomer.tags.includes(tag)) {
      const nextTags = [...selectedCustomer.tags, tag];
      updateCustomerMeta(selectedCustomer.id, { tags: nextTags });
      setSelectedCustomer((prev) => (prev ? { ...prev, tags: nextTags } : null));
      setNewTagInput("");
      loadData();
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    if (!selectedCustomer) return;
    const nextTags = selectedCustomer.tags.filter((t) => t !== tagToRemove);
    updateCustomerMeta(selectedCustomer.id, { tags: nextTags });
    setSelectedCustomer((prev) => (prev ? { ...prev, tags: nextTags } : null));
    loadData();
  };

  const handleMarkFollowUp = (taskId: string, status: "sent" | "dismissed") => {
    markFollowUpStatus(taskId, status);
    loadData();
  };

  return (
    <RequireAuth>
      <div className="space-y-6 max-w-7xl mx-auto pb-16">
        {/* Page Header */}
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-on-surface tracking-tight">
              Customer CRM & Post-Sale Care
            </h1>
            <p className="text-on-surface-variant text-sm mt-1">
              Farmer directory, lifetime purchases, and automated chick follow-up reminders.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab("directory")}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors ${
                activeTab === "directory"
                  ? "bg-primary text-white shadow-sm"
                  : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
              }`}
            >
              Farmers ({customers.length})
            </button>
            <button
              onClick={() => setActiveTab("followups")}
              className={`relative px-4 py-2 rounded-xl text-sm font-bold transition-colors ${
                activeTab === "followups"
                  ? "bg-primary text-white shadow-sm"
                  : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
              }`}
            >
              Follow-ups
              {dueTodayFollowUps.length > 0 && (
                <span className="ml-2 px-2 py-0.5 text-xs bg-error text-white rounded-full font-extrabold">
                  {dueTodayFollowUps.length}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-4 bg-surface-container-lowest border-outline-variant/60">
            <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              Total Farmers
            </p>
            <p className="text-2xl sm:text-3xl font-extrabold text-on-surface mt-1">
              {customers.length}
            </p>
            <p className="text-xs text-on-surface-variant mt-1">Registered in system</p>
          </Card>

          <Card className="p-4 bg-surface-container-lowest border-outline-variant/60">
            <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              Repeat Rate
            </p>
            <p className="text-2xl sm:text-3xl font-extrabold text-primary mt-1">
              {repeatRate}%
            </p>
            <p className="text-xs text-on-surface-variant mt-1">
              {repeatCount} farmers ordered 2+ times
            </p>
          </Card>

          <Card className="p-4 bg-surface-container-lowest border-outline-variant/60">
            <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              Customer Revenue
            </p>
            <p className="text-2xl sm:text-3xl font-extrabold text-emerald-600 mt-1">
              {formatMoney(totalRevenue)}
            </p>
            <p className="text-xs text-on-surface-variant mt-1">Lifetime total sales</p>
          </Card>

          <Card className="p-4 bg-surface-container-lowest border-outline-variant/60">
            <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              Care Check-ins Due
            </p>
            <p className={`text-2xl sm:text-3xl font-extrabold mt-1 ${dueTodayFollowUps.length ? 'text-amber-600' : 'text-on-surface'}`}>
              {dueTodayFollowUps.length}
            </p>
            <p className="text-xs text-on-surface-variant mt-1">
              {pendingFollowUps.length} pending total
            </p>
          </Card>
        </div>

        {/* Tab 1: Farmers Directory */}
        {activeTab === "directory" && (
          <div className="space-y-4">
            {/* Search and Tag Filters */}
            <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
              <div className="flex-1 max-w-md">
                <Input
                  placeholder="Search by name, phone, or town..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              {allTags.length > 0 && (
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                  <button
                    onClick={() => setSelectedTag("all")}
                    className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                      selectedTag === "all"
                        ? "bg-on-surface text-surface font-bold"
                        : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
                    }`}
                  >
                    All Tags
                  </button>
                  {allTags.map((t) => (
                    <button
                      key={t}
                      onClick={() => setSelectedTag(t)}
                      className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                        selectedTag === t
                          ? "bg-primary text-white font-bold"
                          : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Customers Table / Grid */}
            {filteredCustomers.length === 0 ? (
              <EmptyState
                title="No farmers found"
                description={
                  customers.length === 0
                    ? "Farmers will automatically appear here when orders or walk-in sales are recorded."
                    : "No farmers match your current search or tag filter."
                }
              />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredCustomers.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => handleOpenDetail(c)}
                    className="farm-card border border-outline-variant/60 rounded-3xl p-5 bg-white shadow-sm hover:shadow-md hover:border-primary/40 transition-all cursor-pointer flex flex-col justify-between space-y-4"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="font-bold text-lg text-on-surface">{c.name}</h3>
                          <p className="text-xs text-on-surface-variant flex items-center gap-1 mt-0.5">
                            <span className="material-symbols-outlined text-[14px]">call</span>
                            {c.phone}
                          </p>
                        </div>
                        <span className="text-base font-extrabold text-primary">
                          {formatMoney(c.totalSpend)}
                        </span>
                      </div>

                      {c.location && (
                        <p className="text-xs text-on-surface-variant/80 flex items-center gap-1 mt-2">
                          <span className="material-symbols-outlined text-[14px]">location_on</span>
                          {c.location}
                        </p>
                      )}

                      <div className="flex flex-wrap gap-1 mt-3">
                        {c.tags.map((t) => (
                          <Badge key={t} variant={t.includes("VIP") ? "success" : "neutral"} className="text-[10px]">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <div className="pt-3 border-t border-outline-variant/40 flex items-center justify-between text-xs text-on-surface-variant">
                      <span>{c.totalOrdersCount} orders ({c.totalChicksBought} birds)</span>
                      <span className="text-primary font-semibold hover:underline flex items-center gap-0.5">
                        Details <span className="material-symbols-outlined text-[14px]">chevron_right</span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Follow-Up Action Center */}
        {activeTab === "followups" && (
          <div className="space-y-4">
            <div className="bg-primary/5 border border-primary/20 rounded-3xl p-4 sm:p-6 space-y-2">
              <h2 className="text-lg font-bold text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">support_agent</span>
                Automated Post-Sale Farmer Engagement
              </h2>
              <p className="text-sm text-on-surface-variant">
                Farmers who receive brooding support and vaccination advice have 3× higher repeat chick order rates. Contact farmers on Day 3, 14, and 30 after their purchase.
              </p>
            </div>

            {followUps.length === 0 ? (
              <EmptyState
                title="No follow-up reminders"
                description="Follow-up tasks will automatically be scheduled when farmers purchase chicks."
              />
            ) : (
              <div className="space-y-3">
                {followUps.map((task) => {
                  const isDue = task.dueDate <= today && task.status === "pending";
                  const isSent = task.status === "sent";
                  const isDismissed = task.status === "dismissed";
                  const waUrl = generateFollowUpWhatsAppUrl(task);

                  return (
                    <div
                      key={task.id}
                      className={`border rounded-3xl p-4 sm:p-5 transition-all ${
                        isDue
                          ? "bg-amber-50/40 border-amber-300 shadow-sm"
                          : isSent
                            ? "bg-emerald-50/30 border-emerald-200 opacity-75"
                            : isDismissed
                              ? "bg-surface-container-lowest border-outline-variant/30 opacity-50"
                              : "bg-white border-outline-variant/60"
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-base text-on-surface">
                              {task.customerName}
                            </span>
                            <span className="text-xs text-on-surface-variant font-mono">
                              ({task.customerPhone})
                            </span>
                            {isDue && (
                              <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider bg-amber-500 text-white rounded-md">
                                Due Today
                              </span>
                            )}
                            {isSent && (
                              <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-emerald-600 text-white rounded-md">
                                Contacted ✓
                              </span>
                            )}
                          </div>

                          <p className="text-sm font-semibold text-primary">
                            {task.title} · <span className="text-on-surface-variant font-normal">{task.chickSummary}</span>
                          </p>
                          <p className="text-xs text-on-surface-variant">
                            {task.description} (Target date: {task.dueDate})
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                          {task.status === "pending" ? (
                            <>
                              <a
                                href={waUrl}
                                target="_blank"
                                rel="noreferrer"
                                onClick={() => handleMarkFollowUp(task.id, "sent")}
                                className="h-10 px-4 bg-[#25D366] text-white text-xs font-bold rounded-xl flex items-center gap-1.5 hover:bg-[#20bd5a] transition-colors shadow-sm"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 00-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                                WhatsApp
                              </a>
                              <button
                                onClick={() => handleMarkFollowUp(task.id, "sent")}
                                className="h-10 px-3 bg-surface-container text-on-surface text-xs font-semibold rounded-xl hover:bg-surface-container-high transition-colors"
                              >
                                Mark Done
                              </button>
                              <button
                                onClick={() => handleMarkFollowUp(task.id, "dismissed")}
                                className="h-10 px-2.5 text-on-surface-variant hover:text-error text-xs transition-colors"
                                title="Dismiss"
                              >
                                Dismiss
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => handleMarkFollowUp(task.id, "pending" as any)}
                              className="text-xs text-primary font-medium hover:underline"
                            >
                              Re-open
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Customer Detail Drawer / Modal */}
        {selectedCustomer && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white border border-outline-variant rounded-3xl max-w-xl w-full p-6 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200">
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-2xl font-bold text-on-surface">{selectedCustomer.name}</h2>
                  <p className="text-sm text-on-surface-variant flex items-center gap-1.5 mt-1">
                    <span className="material-symbols-outlined text-[16px]">call</span>
                    {selectedCustomer.phone}
                    {selectedCustomer.location && ` · ${selectedCustomer.location}`}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedCustomer(null)}
                  className="w-9 h-9 rounded-full bg-surface-container flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high transition-colors"
                >
                  ✕
                </button>
              </div>

              {/* Summary Stats */}
              <div className="grid grid-cols-3 gap-3 bg-surface-container-lowest rounded-2xl p-4 border border-outline-variant/50 text-center">
                <div>
                  <p className="text-[10px] font-bold uppercase text-on-surface-variant">Lifetime Spend</p>
                  <p className="text-lg font-extrabold text-primary mt-0.5">{formatMoney(selectedCustomer.totalSpend)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase text-on-surface-variant">Total Birds</p>
                  <p className="text-lg font-extrabold text-on-surface mt-0.5">{selectedCustomer.totalChicksBought}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase text-on-surface-variant">Orders</p>
                  <p className="text-lg font-extrabold text-on-surface mt-0.5">{selectedCustomer.totalOrdersCount}</p>
                </div>
              </div>

              {/* Tags Management */}
              <div className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Customer Tags</p>
                <div className="flex flex-wrap gap-1.5 items-center">
                  {selectedCustomer.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-surface-container text-on-surface rounded-full text-xs font-semibold"
                    >
                      {tag}
                      <button
                        onClick={() => handleRemoveTag(tag)}
                        className="hover:text-error text-on-surface-variant/80 ml-0.5"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <div className="flex items-center gap-1">
                    <input
                      placeholder="Add tag..."
                      value={newTagInput}
                      onChange={(e) => setNewTagInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
                      className="h-7 text-xs px-2.5 bg-surface-container-lowest border border-outline-variant rounded-full outline-none focus:border-primary w-24"
                    />
                    <button
                      onClick={handleAddTag}
                      className="text-xs text-primary font-bold px-2 py-1"
                    >
                      + Add
                    </button>
                  </div>
                </div>
              </div>

              {/* Staff Notes */}
              <div className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Internal Staff Notes</p>
                <textarea
                  rows={3}
                  value={editingNotes}
                  onChange={(e) => setEditingNotes(e.target.value)}
                  placeholder="Record special delivery instructions, coop size, or farmer preferences..."
                  className="w-full text-sm p-3 bg-surface-container-lowest border border-outline-variant rounded-2xl outline-none focus:border-primary"
                />
                <Button size="sm" onClick={handleSaveNotes}>
                  Save Notes
                </Button>
              </div>

              {/* Direct Actions */}
              <div className="pt-2 border-t border-outline-variant/50 flex gap-3">
                <a
                  href={`https://wa.me/${selectedCustomer.phone.replace(/[^\d+]/g, "")}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 h-12 bg-[#25D366] text-white font-bold rounded-2xl flex items-center justify-center gap-2 text-sm hover:bg-[#20bd5a] transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 00-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                  Chat on WhatsApp
                </a>
                <a
                  href={`tel:${selectedCustomer.phone}`}
                  className="px-6 h-12 bg-surface-container text-on-surface font-bold rounded-2xl flex items-center justify-center gap-2 text-sm hover:bg-surface-container-high transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px]">call</span>
                  Call
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    </RequireAuth>
  );
}
