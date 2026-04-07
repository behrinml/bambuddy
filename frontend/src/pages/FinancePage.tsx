import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Clock3, Wallet } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { Button } from '../components/Button';
import { Card, CardContent, CardHeader } from '../components/Card';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { getCurrencySymbol } from '../utils/currency';
import { parseUTCDate } from '../utils/date';

function formatTimestamp(value: string | null, locale: string): string {
  if (!value) return '-';
  const parsed = parseUTCDate(value);
  if (!parsed) return value;
  return parsed.toLocaleString(locale);
}

function parseBudgetValue(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

const fieldClass =
  'w-full px-3 py-2 text-sm bg-bambu-dark border border-bambu-dark-tertiary rounded text-white placeholder-bambu-gray focus:outline-none focus:ring-1 focus:ring-bambu-green';
const labelClass = 'block text-sm font-medium text-white mb-1';
const tableHeadCellClass = 'px-4 py-3 text-left text-bambu-gray font-medium';
const tableCellClass = 'px-4 py-3 align-top text-white';

interface FinanceModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

function FinanceModal({ title, onClose, children, size = 'md' }: FinanceModalProps) {
  const { t } = useTranslation();
  const sizeClass = size === 'sm' ? 'max-w-xl' : size === 'lg' ? 'max-w-6xl' : 'max-w-4xl';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className={`w-full ${sizeClass} overflow-hidden rounded-lg border border-bambu-dark-tertiary bg-bambu-dark-secondary`}>
        <div className="flex items-center justify-between border-b border-bambu-dark-tertiary px-4 py-3">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <Button size="sm" variant="secondary" onClick={onClose}>{t('common.close', 'Close')}</Button>
        </div>
        <div className="max-h-[75vh] overflow-auto p-4">{children}</div>
      </div>
    </div>
  );
}

export function FinancePage() {
  const { t, i18n } = useTranslation();
  const { hasPermission, user } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const canReadOwn = hasPermission('finance:read_own');
  const canReadAllFinance = hasPermission('finance:read_all');
  const canCreateCostCenters = hasPermission('finance:cost_centers:create');
  const canUpdateCostCenters = hasPermission('finance:cost_centers:update');
  const canUpdateBudgets = hasPermission('finance:budgets:update');
  const canAssignCostCenterUsers = hasPermission('finance:cost_centers:assign_users');
  const canAdjustWallet = hasPermission('finance:transactions:create');
  const canReadUsers = hasPermission('users:read');

  const canAccessAllCostCenters =
    canReadAllFinance ||
    canCreateCostCenters ||
    canUpdateCostCenters ||
    canUpdateBudgets ||
    canAssignCostCenterUsers ||
    canAdjustWallet;

  const canAccessFinance = canReadOwn || canAccessAllCostCenters;
  const canViewMyCostCenters = canAccessFinance;

  const [newCenterName, setNewCenterName] = useState('');
  const [newCenterBudgetMode, setNewCenterBudgetMode] = useState<'total' | 'monthly'>('monthly');
  const [newCenterBudgetValue, setNewCenterBudgetValue] = useState('');

  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [selectedAdjustmentType, setSelectedAdjustmentType] = useState<'deposit' | 'withdraw'>('deposit');
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  const [adjustmentDescription, setAdjustmentDescription] = useState('');
  const [adjustmentCostCenterId, setAdjustmentCostCenterId] = useState<number | null>(null);

  const [selectedManageCenterId, setSelectedManageCenterId] = useState<number | null>(null);
  const [memberUserId, setMemberUserId] = useState<number | null>(null);
  const [memberCanPrint, setMemberCanPrint] = useState(true);

  const [txOffset, setTxOffset] = useState(0);
  const txLimit = 50;
  const [txTypeFilter, setTxTypeFilter] = useState<string>('all');
  const [txCostCenterFilter, setTxCostCenterFilter] = useState<number | 'all'>('all');

  const [showCreateCenterModal, setShowCreateCenterModal] = useState(false);
  const [showAdjustWalletModal, setShowAdjustWalletModal] = useState(false);
  const [showMembersModal, setShowMembersModal] = useState(false);
  const [showEditCenterModal, setShowEditCenterModal] = useState(false);
  const [financeViewMode, setFinanceViewMode] = useState<'personal' | 'admin'>('personal');
  const [selectedEditCenterId, setSelectedEditCenterId] = useState<number | null>(null);
  const [editCenterName, setEditCenterName] = useState('');
  const [editCenterBudgetMode, setEditCenterBudgetMode] = useState<'total' | 'monthly'>('monthly');
  const [editCenterBudgetValue, setEditCenterBudgetValue] = useState('');

  const hasAdminFinanceControls =
    canReadAllFinance ||
    canCreateCostCenters ||
    canUpdateCostCenters ||
    canUpdateBudgets ||
    (canAdjustWallet && canReadUsers) ||
    (canAssignCostCenterUsers && canReadUsers);

  useEffect(() => {
    if (!hasAdminFinanceControls) {
      setFinanceViewMode('personal');
    }
  }, [hasAdminFinanceControls]);

  const { data: wallet, isLoading: walletLoading } = useQuery({
    queryKey: ['finance', 'me', 'balance'],
    queryFn: api.getMyBalance,
    enabled: canReadOwn,
  });

  const { data: transactionsResponse, isLoading: txLoading } = useQuery({
    queryKey: ['finance', 'me', 'transactions', txLimit, txOffset],
    queryFn: () => api.getMyTransactions(txLimit, txOffset),
    enabled: canReadOwn,
  });

  const { data: costCenters, isLoading: centersLoading } = useQuery({
    queryKey: ['finance', 'cost-centers', financeViewMode],
    queryFn: () => (financeViewMode === 'admin' && canAccessAllCostCenters ? api.listCostCenters(true) : api.getMyCostCenters()),
    enabled: canViewMyCostCenters,
  });

  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: api.getUsers,
    enabled: canReadUsers && (canViewMyCostCenters || canAdjustWallet || canAssignCostCenterUsers),
  });

  const { data: selectedCenterDetail } = useQuery({
    queryKey: ['finance', 'cost-center', selectedManageCenterId],
    queryFn: () => api.getCostCenter(selectedManageCenterId!),
    enabled: canAssignCostCenterUsers && selectedManageCenterId != null,
  });

  useEffect(() => {
    if (!users || users.length === 0) return;
    if (selectedUserId != null && users.some((u) => u.id === selectedUserId)) return;
    setSelectedUserId(users[0].id);
  }, [users, selectedUserId]);

  useEffect(() => {
    if (!canAssignCostCenterUsers) return;
    const sharedCenters = (costCenters || []).filter((c) => !c.is_private);
    if (sharedCenters.length === 0) {
      setSelectedManageCenterId(null);
      return;
    }
    if (selectedManageCenterId != null && sharedCenters.some((c) => c.id === selectedManageCenterId)) return;
    setSelectedManageCenterId(sharedCenters[0].id);
  }, [canAssignCostCenterUsers, costCenters, selectedManageCenterId]);

  useEffect(() => {
    if (!canAssignCostCenterUsers || !users || users.length === 0) return;
    const existingMemberIds = new Set((selectedCenterDetail?.members || []).map((m) => m.user_id));
    const firstAvailable = users.find((u) => !existingMemberIds.has(u.id));
    setMemberUserId(firstAvailable ? firstAvailable.id : null);
  }, [canAssignCostCenterUsers, users, selectedCenterDetail]);

  useEffect(() => {
    if (!showEditCenterModal) return;
    const editableCenters = (costCenters || []).filter((center) => !center.is_private);
    if (editableCenters.length === 0) {
      setSelectedEditCenterId(null);
      return;
    }
    if (selectedEditCenterId != null && editableCenters.some((center) => center.id === selectedEditCenterId)) return;
    setSelectedEditCenterId(editableCenters[0].id);
  }, [showEditCenterModal, selectedEditCenterId, costCenters]);

  useEffect(() => {
    if (!showEditCenterModal || selectedEditCenterId == null) return;
    const center = (costCenters || []).find((entry) => entry.id === selectedEditCenterId);
    if (!center) return;
    setEditCenterName(center.name);
    if (center.budget_mode === 'total') {
      setEditCenterBudgetMode('total');
      setEditCenterBudgetValue(center.total_budget == null ? '' : String(center.total_budget));
      return;
    }
    setEditCenterBudgetMode('monthly');
    setEditCenterBudgetValue(center.monthly_budget == null ? '' : String(center.monthly_budget));
  }, [showEditCenterModal, selectedEditCenterId, costCenters]);

  const createCostCenterMutation = useMutation({
    mutationFn: () =>
      api.createCostCenter({
        name: newCenterName.trim(),
        total_budget: newCenterBudgetMode === 'total' ? parseBudgetValue(newCenterBudgetValue) : null,
        monthly_budget: newCenterBudgetMode === 'monthly' ? parseBudgetValue(newCenterBudgetValue) : null,
        is_active: true,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance'] });
      setNewCenterName('');
      setNewCenterBudgetValue('');
      showToast(t('finance.createdCostCenter', 'Cost center created'));
    },
    onError: (error: Error) => {
      showToast(error.message || t('finance.createCostCenterFailed', 'Failed to create cost center'), 'error');
    },
  });

  const updateBudgetMutation = useMutation({
    mutationFn: ({ costCenterId, value, mode }: { costCenterId: number; value: string; mode: 'total' | 'monthly' }) =>
      api.updateCostCenterBudgets(costCenterId, {
        total_budget: mode === 'total' ? parseBudgetValue(value) : null,
        monthly_budget: mode === 'monthly' ? parseBudgetValue(value) : null,
      }),
  });

  const updateCostCenterMutation = useMutation({
    mutationFn: ({ costCenterId, name }: { costCenterId: number; name: string }) =>
      api.updateCostCenter(costCenterId, {
        name,
      }),
  });

  const depositMutation = useMutation({
    mutationFn: (payload: { userId: number; amount: number; description?: string; costCenterId?: number | null }) =>
      api.depositUserBalance(payload.userId, {
        amount: payload.amount,
        description: payload.description,
        cost_center_id: payload.costCenterId ?? null,
      }),
  });

  const withdrawMutation = useMutation({
    mutationFn: (payload: { userId: number; amount: number; description?: string; costCenterId?: number | null }) =>
      api.withdrawUserBalance(payload.userId, {
        amount: payload.amount,
        description: payload.description,
        cost_center_id: payload.costCenterId ?? null,
      }),
  });

  const upsertMemberMutation = useMutation({
    mutationFn: (payload: { costCenterId: number; userId: number; canPrint: boolean }) =>
      api.upsertCostCenterMember(payload.costCenterId, {
        user_id: payload.userId,
        can_print: payload.canPrint,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance'] });
      showToast(t('finance.memberSaved', 'Member saved'));
    },
    onError: (error: Error) => {
      showToast(error.message || t('finance.memberSaveFailed', 'Failed to save member'), 'error');
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (payload: { costCenterId: number; userId: number }) =>
      api.removeCostCenterMember(payload.costCenterId, payload.userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance'] });
      showToast(t('finance.memberRemoved', 'Member removed'));
    },
    onError: (error: Error) => {
      showToast(error.message || t('finance.memberRemoveFailed', 'Failed to remove member'), 'error');
    },
  });

  const isAdjustingWallet = depositMutation.isPending || withdrawMutation.isPending;

  const handleCreateCostCenter = () => {
    if (!newCenterName.trim()) {
      showToast(t('finance.costCenterNameRequired', 'Cost center name is required'), 'error');
      return;
    }
    createCostCenterMutation.mutate();
  };

  const handleSaveEditedCenter = async () => {
    if (selectedEditCenterId == null) {
      showToast(t('finance.selectCostCenter', 'Please select a cost center'), 'error');
      return;
    }

    const name = editCenterName.trim();
    if (!name) {
      showToast(t('finance.costCenterNameRequired', 'Cost center name is required'), 'error');
      return;
    }

    try {
      if (canUpdateCostCenters) {
        await updateCostCenterMutation.mutateAsync({ costCenterId: selectedEditCenterId, name });
      }
      if (canUpdateBudgets) {
        await updateBudgetMutation.mutateAsync({
          costCenterId: selectedEditCenterId,
          mode: editCenterBudgetMode,
          value: editCenterBudgetValue,
        });
      }
      queryClient.invalidateQueries({ queryKey: ['finance'] });
      showToast(t('finance.costCenterUpdated', 'Cost center updated'));
      setShowEditCenterModal(false);
    } catch (error) {
      showToast((error as Error).message || t('finance.costCenterUpdateFailed', 'Failed to update cost center'), 'error');
    }
  };

  const handleWalletAdjustment = async () => {
    if (selectedUserId == null) {
      showToast(t('finance.userRequired', 'Please select a user'), 'error');
      return;
    }

    const amount = Number.parseFloat(adjustmentAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast(t('finance.amountMustBePositive', 'Amount must be greater than zero'), 'error');
      return;
    }

    const payload = {
      userId: selectedUserId,
      amount,
      description: adjustmentDescription.trim() || undefined,
      costCenterId: adjustmentCostCenterId,
    };

    try {
      if (selectedAdjustmentType === 'deposit') {
        await depositMutation.mutateAsync(payload);
      } else {
        await withdrawMutation.mutateAsync(payload);
      }
      queryClient.invalidateQueries({ queryKey: ['finance'] });
      setAdjustmentAmount('');
      setAdjustmentDescription('');
      showToast(
        selectedAdjustmentType === 'deposit'
          ? t('finance.depositSuccess', 'Deposit successful')
          : t('finance.withdrawSuccess', 'Withdrawal successful')
      );
    } catch (error) {
      showToast((error as Error).message || t('finance.adjustmentFailed', 'Wallet adjustment failed'), 'error');
    }
  };

  const handleAddMember = () => {
    if (selectedManageCenterId == null) {
      showToast(t('finance.selectCostCenter', 'Please select a cost center'), 'error');
      return;
    }
    if (memberUserId == null) {
      showToast(t('finance.noEligibleUsers', 'No eligible users available'), 'error');
      return;
    }
    upsertMemberMutation.mutate({
      costCenterId: selectedManageCenterId,
      userId: memberUserId,
      canPrint: memberCanPrint,
    });
  };

  const handleRemoveMember = (userId: number) => {
    if (selectedManageCenterId == null) return;
    removeMemberMutation.mutate({ costCenterId: selectedManageCenterId, userId });
  };

  const currency = wallet?.currency || 'EUR';
  const currencySymbol = getCurrencySymbol(currency);

  const sortedUsers = useMemo(() => {
    return [...(users || [])].sort((a, b) => a.username.localeCompare(b.username));
  }, [users]);

  const usersById = useMemo(() => {
    const map = new Map<number, string>();
    for (const entry of sortedUsers) {
      map.set(entry.id, entry.username);
    }
    return map;
  }, [sortedUsers]);

  const availableUsersForCenter = useMemo(() => {
    const existingIds = new Set((selectedCenterDetail?.members || []).map((m) => m.user_id));
    return sortedUsers.filter((u) => !existingIds.has(u.id));
  }, [sortedUsers, selectedCenterDetail]);

  const transactions = transactionsResponse?.items || [];
  const txTotal = transactionsResponse?.total ?? 0;
  const txTotalPages = Math.max(1, Math.ceil(txTotal / txLimit));

  const filteredTransactions = useMemo(() => {
    const items = transactions;
    return items.filter((tx) => {
      if (txTypeFilter !== 'all' && tx.transaction_type !== txTypeFilter) return false;
      if (txCostCenterFilter !== 'all' && tx.cost_center_id !== txCostCenterFilter) return false;
      return true;
    });
  }, [transactions, txTypeFilter, txCostCenterFilter]);

  const txPage = Math.floor(txOffset / txLimit) + 1;
  const showCostCenterAccountColumn = financeViewMode === 'admin';

  const getPrivateOwnerLabel = (ownerUserId: number | null): string => {
    if (ownerUserId == null) return t('finance.personal', 'Personal');
    const ownerName = usersById.get(ownerUserId);
    if (ownerName) return ownerName;
    if (user?.id === ownerUserId && user.username) return user.username;
    return t('finance.userWithId', 'User #{{id}}', { id: ownerUserId });
  };

  const formatBudgetProgress = (center: { budget_available: number | null; budget_limit: number | null }) => {
    if (center.budget_limit == null || center.budget_available == null) return '-';
    return `${currencySymbol}${center.budget_available.toFixed(2)}/${currencySymbol}${center.budget_limit.toFixed(2)}`;
  };

  if (!canAccessFinance) {
    return (
      <div className="p-4 md:p-8 space-y-6">
        <div className="flex items-center gap-2">
          <Wallet className="h-6 w-6 text-bambu-green" />
          <h1 className="text-2xl font-bold text-white">{t('finance.title', 'Finance')}</h1>
        </div>
        <div>
          <p className="text-bambu-gray mt-2 max-w-2xl">{t('finance.subtitle', 'Wallet, transactions, and cost centers')}</p>
        </div>
        <Card>
          <CardContent className="py-8 text-center text-bambu-gray">
            {t('finance.noAccess', 'You do not have permission to view finance data.')}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Wallet className="h-6 w-6 text-bambu-green" />
            <h1 className="text-2xl font-bold text-white">{t('finance.title', 'Finance')}</h1>
          </div>
          <p className="text-bambu-gray mt-2 max-w-2xl">{t('finance.subtitle', 'Wallet, transactions, and cost centers')}</p>
        </div>

        <div className="flex flex-col gap-2 lg:items-end">
          {hasAdminFinanceControls && (
            <div className="inline-flex overflow-hidden rounded border border-bambu-dark-tertiary">
              <button
                type="button"
                onClick={() => setFinanceViewMode('personal')}
                className={`px-3 py-1.5 text-sm ${financeViewMode === 'personal' ? 'bg-bambu-green text-black font-medium' : 'bg-bambu-dark text-bambu-gray'}`}
              >
                {t('finance.personalView', 'Personal view')}
              </button>
              <button
                type="button"
                onClick={() => setFinanceViewMode('admin')}
                className={`px-3 py-1.5 text-sm ${financeViewMode === 'admin' ? 'bg-bambu-green text-black font-medium' : 'bg-bambu-dark text-bambu-gray'}`}
              >
                {t('finance.adminView', 'Admin view')}
              </button>
            </div>
          )}

          {financeViewMode === 'admin' && hasAdminFinanceControls && (
            <div className="flex flex-wrap gap-2 lg:justify-end">
            {canCreateCostCenters && (
              <Button size="sm" variant="secondary" onClick={() => setShowCreateCenterModal(true)}>
                {t('finance.createCostCenter', 'Create cost center')}
              </Button>
            )}
            {(canUpdateCostCenters || canUpdateBudgets) && (
              <Button size="sm" variant="secondary" onClick={() => setShowEditCenterModal(true)}>
                {t('finance.editCostCenter', 'Edit cost center')}
              </Button>
            )}
            {canAdjustWallet && canReadUsers && (
              <Button size="sm" variant="secondary" onClick={() => setShowAdjustWalletModal(true)}>
                {t('finance.adjustWallet', 'Adjust wallet')}
              </Button>
            )}
            {canAssignCostCenterUsers && canReadUsers && (
              <Button size="sm" variant="secondary" onClick={() => setShowMembersModal(true)}>
                {t('finance.manageMembers', 'Manage cost center members')}
              </Button>
            )}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <span className="text-sm text-bambu-gray">{t('finance.currentBalance', 'Current balance')}</span>
            <Wallet className="w-4 h-4 text-bambu-green/90" />
          </CardHeader>
          <CardContent className="pt-1">
            <p className="text-3xl font-semibold text-white leading-tight">
              {walletLoading ? t('common.loading', 'Loading...') : `${currencySymbol}${(wallet?.balance ?? 0).toFixed(2)}`}
            </p>
            <p className="text-xs text-bambu-gray mt-3">
              {t('finance.lastUpdated', 'Updated')}: {formatTimestamp(wallet?.updated_at ?? null, i18n.language)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <span className="text-sm text-bambu-gray">{t('finance.transactions', 'Transactions')}</span>
            <Clock3 className="w-4 h-4 text-blue-400" />
          </CardHeader>
          <CardContent className="pt-1">
            <p className="text-3xl font-semibold text-white leading-tight">{txLoading ? '-' : transactions?.length ?? 0}</p>
            <p className="text-xs text-bambu-gray mt-3">{t('finance.paginationHint', 'Use pagination below to browse all transactions.')}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <span className="text-sm text-bambu-gray">{t('finance.costCenters', 'Cost centers')}</span>
            <Building2 className="w-4 h-4 text-orange-400" />
          </CardHeader>
          <CardContent className="pt-1">
            <p className="text-3xl font-semibold text-white leading-tight">{centersLoading ? '-' : costCenters?.length ?? 0}</p>
            <p className="text-xs text-bambu-gray mt-3">{t('finance.availableForPrinting', 'Available for print assignment')}</p>
          </CardContent>
        </Card>
      </div>

      {showCreateCenterModal && canCreateCostCenters && (
        <FinanceModal title={t('finance.createCostCenter', 'Create cost center')} size="md" onClose={() => setShowCreateCenterModal(false)}>
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className={labelClass}>{t('finance.costCenterName', 'Name')}</label>
                <input
                  type="text"
                  value={newCenterName}
                  onChange={(e) => setNewCenterName(e.target.value)}
                  placeholder={t('finance.costCenterName', 'Name')}
                  className={fieldClass}
                />
              </div>
              <div>
                <label className={labelClass}>{t('finance.budgetType', 'Budget type')}</label>
                <select
                  value={newCenterBudgetMode}
                  onChange={(e) => setNewCenterBudgetMode(e.target.value as 'total' | 'monthly')}
                  className={fieldClass}
                >
                  <option value="monthly">{t('finance.monthlyBudget', 'Monthly budget')}</option>
                  <option value="total">{t('finance.totalBudget', 'Total budget')}</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>
                  {newCenterBudgetMode === 'monthly' ? t('finance.monthlyBudget', 'Monthly budget') : t('finance.totalBudget', 'Total budget')}
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={newCenterBudgetValue}
                  onChange={(e) => setNewCenterBudgetValue(e.target.value)}
                  placeholder="0.00"
                  className={fieldClass}
                />
              </div>
            </div>
            <Button className="min-w-[180px]" onClick={handleCreateCostCenter} disabled={createCostCenterMutation.isPending}>
              {createCostCenterMutation.isPending ? t('common.saving', 'Saving...') : t('finance.create', 'Create')}
            </Button>
          </div>
        </FinanceModal>
      )}

      {showAdjustWalletModal && canAdjustWallet && canReadUsers && (
        <FinanceModal title={t('finance.adjustWallet', 'Adjust wallet')} size="md" onClose={() => setShowAdjustWalletModal(false)}>
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className={labelClass}>{t('finance.selectUser', 'Select user')}</label>
                <select
                  value={selectedUserId ?? ''}
                  onChange={(e) => setSelectedUserId(e.target.value ? Number(e.target.value) : null)}
                  className={fieldClass}
                >
                  {(sortedUsers || []).map((u) => (
                    <option key={u.id} value={u.id}>{u.username}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelClass}>{t('finance.transactionType', 'Type')}</label>
                <select
                  value={selectedAdjustmentType}
                  onChange={(e) => setSelectedAdjustmentType(e.target.value as 'deposit' | 'withdraw')}
                  className={fieldClass}
                >
                  <option value="deposit">{t('finance.deposit', 'Deposit')}</option>
                  <option value="withdraw">{t('finance.withdraw', 'Withdraw')}</option>
                </select>
              </div>

              <div>
                <label className={labelClass}>{t('finance.amount', 'Amount')}</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={adjustmentAmount}
                  onChange={(e) => setAdjustmentAmount(e.target.value)}
                  placeholder="0.00"
                  className={fieldClass}
                />
              </div>

              <div>
                <label className={labelClass}>{t('finance.costCenters', 'Cost centers')}</label>
                <select
                  value={adjustmentCostCenterId ?? ''}
                  onChange={(e) => setAdjustmentCostCenterId(e.target.value ? Number(e.target.value) : null)}
                  className={fieldClass}
                >
                  <option value="">{t('finance.noCostCenter', 'No cost center')}</option>
                  {(costCenters || []).map((center) => (
                    <option key={center.id} value={center.id}>{center.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className={labelClass}>{t('common.description', 'Description')}</label>
              <input
                type="text"
                value={adjustmentDescription}
                onChange={(e) => setAdjustmentDescription(e.target.value)}
                placeholder={t('finance.descriptionOptional', 'Description (optional)')}
                className={fieldClass}
              />
            </div>

            <Button className="min-w-[180px]" onClick={handleWalletAdjustment} disabled={isAdjustingWallet}>
              {isAdjustingWallet ? t('common.saving', 'Saving...') : t('finance.applyAdjustment', 'Apply adjustment')}
            </Button>
          </div>
        </FinanceModal>
      )}

      {showMembersModal && canAssignCostCenterUsers && canReadUsers && (
        <FinanceModal title={t('finance.manageMembers', 'Manage cost center members')} size="lg" onClose={() => setShowMembersModal(false)}>
          <div className="space-y-5">
            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <label className={labelClass}>{t('finance.costCenters', 'Cost centers')}</label>
                <select
                  value={selectedManageCenterId ?? ''}
                  onChange={(e) => setSelectedManageCenterId(e.target.value ? Number(e.target.value) : null)}
                  className={fieldClass}
                >
                  {(costCenters || [])
                    .filter((center) => !center.is_private)
                    .map((center) => (
                      <option key={center.id} value={center.id}>{center.name}</option>
                    ))}
                </select>
              </div>

              <div>
                <label className={labelClass}>{t('finance.selectUser', 'Select user')}</label>
                <select
                  value={memberUserId ?? ''}
                  onChange={(e) => setMemberUserId(e.target.value ? Number(e.target.value) : null)}
                  className={fieldClass}
                >
                  <option value="">{t('finance.selectUser', 'Select user')}</option>
                  {availableUsersForCenter.map((u) => (
                    <option key={u.id} value={u.id}>{u.username}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2 rounded border border-bambu-dark-tertiary bg-bambu-dark-secondary px-3 py-2">
                <input
                  id="memberCanPrint"
                  type="checkbox"
                  checked={memberCanPrint}
                  onChange={(e) => setMemberCanPrint(e.target.checked)}
                  className="rounded border-bambu-dark-tertiary bg-bambu-dark text-bambu-green focus:ring-bambu-green"
                />
                <label htmlFor="memberCanPrint" className="text-sm text-bambu-gray">
                  {t('finance.memberCanPrint', 'Member can print')}
                </label>
              </div>

              <div className="flex items-end">
                <Button className="min-w-[180px]" onClick={handleAddMember} disabled={upsertMemberMutation.isPending || memberUserId == null}>
                  {upsertMemberMutation.isPending ? t('common.saving', 'Saving...') : t('finance.addMember', 'Add member')}
                </Button>
              </div>
            </div>

            <div className="overflow-auto rounded-lg border border-bambu-dark-tertiary">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-bambu-dark-tertiary bg-bambu-dark text-bambu-gray">
                    <th className={tableHeadCellClass}>{t('common.name', 'Name')}</th>
                    <th className={tableHeadCellClass}>{t('finance.canPrint', 'Can print')}</th>
                    <th className={tableHeadCellClass}>{t('common.actions', 'Actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedCenterDetail?.members || []).map((member) => {
                    const user = sortedUsers.find((u) => u.id === member.user_id);
                    return (
                      <tr key={member.id} className="border-b border-bambu-dark-tertiary/60 text-white">
                        <td className={tableCellClass}>{user?.username || `User ${member.user_id}`}</td>
                        <td className={tableCellClass}>{member.can_print ? t('common.yes', 'Yes') : t('common.no', 'No')}</td>
                        <td className={tableCellClass}>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => handleRemoveMember(member.user_id)}
                            disabled={removeMemberMutation.isPending}
                          >
                            {t('common.remove', 'Remove')}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  {(selectedCenterDetail?.members || []).length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-3 text-bambu-gray">
                        {t('finance.noMembers', 'No members assigned.')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </FinanceModal>
      )}

      {showEditCenterModal && (canUpdateCostCenters || canUpdateBudgets) && (
        <FinanceModal title={t('finance.editCostCenter', 'Edit cost center')} size="md" onClose={() => setShowEditCenterModal(false)}>
          <div className="space-y-4">
            <div>
              <label className={labelClass}>{t('finance.costCenters', 'Cost centers')}</label>
              <select
                value={selectedEditCenterId ?? ''}
                onChange={(e) => setSelectedEditCenterId(e.target.value ? Number(e.target.value) : null)}
                className={fieldClass}
              >
                {(costCenters || [])
                  .filter((center) => !center.is_private)
                  .map((center) => (
                    <option key={center.id} value={center.id}>{center.name}</option>
                  ))}
              </select>
            </div>

            <div>
              <label className={labelClass}>{t('finance.costCenterName', 'Name')}</label>
              <input
                type="text"
                value={editCenterName}
                onChange={(e) => setEditCenterName(e.target.value)}
                placeholder={t('finance.costCenterName', 'Name')}
                className={fieldClass}
                disabled={!canUpdateCostCenters}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className={labelClass}>{t('finance.budgetType', 'Budget type')}</label>
                <select
                  value={editCenterBudgetMode}
                  onChange={(e) => setEditCenterBudgetMode(e.target.value as 'total' | 'monthly')}
                  className={fieldClass}
                  disabled={!canUpdateBudgets}
                >
                  <option value="monthly">{t('finance.monthlyBudget', 'Monthly budget')}</option>
                  <option value="total">{t('finance.totalBudget', 'Total budget')}</option>
                </select>
              </div>

              <div>
                <label className={labelClass}>
                  {editCenterBudgetMode === 'monthly' ? t('finance.monthlyBudget', 'Monthly budget') : t('finance.totalBudget', 'Total budget')}
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={editCenterBudgetValue}
                  onChange={(e) => setEditCenterBudgetValue(e.target.value)}
                  placeholder="0.00"
                  className={fieldClass}
                  disabled={!canUpdateBudgets}
                />
              </div>
            </div>

            <Button
              className="min-w-[180px]"
              onClick={handleSaveEditedCenter}
              disabled={updateCostCenterMutation.isPending || updateBudgetMutation.isPending || selectedEditCenterId == null}
            >
              {(updateCostCenterMutation.isPending || updateBudgetMutation.isPending)
                ? t('common.saving', 'Saving...')
                : t('common.save', 'Save')}
            </Button>
          </div>
        </FinanceModal>
      )}

      <div className={`grid gap-6 ${canViewMyCostCenters && canReadOwn ? 'xl:grid-cols-2' : ''}`}>
        {canViewMyCostCenters && (
          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold text-white">{t('finance.myCostCenters', 'My cost centers')}</h2>
              <p className="text-sm text-bambu-gray mt-1">{t('finance.costCentersHint', 'Review budget limits and keep costs under control')}</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {centersLoading && <p className="text-sm text-bambu-gray">{t('common.loading', 'Loading...')}</p>}
              {!centersLoading && (!costCenters || costCenters.length === 0) && (
                <p className="text-sm text-bambu-gray">{t('finance.noCostCenters', 'No cost centers found.')}</p>
              )}
              {!centersLoading && costCenters && costCenters.length > 0 && (
                <div className="overflow-auto rounded-lg border border-bambu-dark-tertiary">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-bambu-dark-tertiary bg-bambu-dark text-bambu-gray">
                          <th className={tableHeadCellClass}>{t('common.name', 'Name')}</th>
                          {showCostCenterAccountColumn && <th className={tableHeadCellClass}>{t('finance.owner', 'Owner')}</th>}
                          <th className={tableHeadCellClass}>{t('finance.budget', 'Budget')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {costCenters.map((center) => {
                        return (
                          <tr key={center.id} className="border-b border-bambu-dark-tertiary/60 text-white">
                              <td className={tableCellClass}>{center.name}</td>
                              {showCostCenterAccountColumn && (
                                <td className={tableCellClass}>{center.is_private ? getPrivateOwnerLabel(center.owner_user_id) : t('finance.shared', 'Shared')}</td>
                              )}
                              <td className={tableCellClass}>
                              <div className="flex flex-col gap-0.5">
                                <span>{formatBudgetProgress(center)}</span>
                                <span className="text-xs text-bambu-gray">
                                  {center.budget_mode === 'monthly'
                                    ? t('finance.monthlyBudget', 'Monthly budget')
                                    : center.budget_mode === 'total'
                                      ? t('finance.totalBudget', 'Total budget')
                                      : t('finance.noBudget', 'No budget')}
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {canReadOwn && (
          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold text-white">{t('finance.recentTransactions', 'Recent transactions')}</h2>
              <p className="text-sm text-bambu-gray mt-1">{t('finance.transactionsHint', 'Filter by type and cost center, then navigate pages')}</p>
            </CardHeader>
            <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className={labelClass}>{t('finance.transactionType', 'Type')}</label>
                <select
                  value={txTypeFilter}
                  onChange={(e) => setTxTypeFilter(e.target.value)}
                  className={fieldClass}
                >
                  <option value="all">{t('finance.allTypes', 'All types')}</option>
                  <option value="deposit">{t('finance.deposit', 'Deposit')}</option>
                  <option value="withdraw">{t('finance.withdraw', 'Withdraw')}</option>
                </select>
              </div>

              <div>
                <label className={labelClass}>{t('finance.costCenters', 'Cost centers')}</label>
                <select
                  value={txCostCenterFilter}
                  onChange={(e) => setTxCostCenterFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                  className={fieldClass}
                >
                  <option value="all">{t('finance.allCostCenters', 'All cost centers')}</option>
                  {(costCenters || []).map((center) => (
                    <option key={center.id} value={center.id}>{center.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-end justify-start md:justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setTxOffset(0)}
                  disabled={txOffset === 0 || txLoading}
                  className="p-1.5 rounded text-bambu-gray hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  aria-label={t('finance.first', 'First')}
                >
                  <ChevronsLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setTxOffset((prev) => Math.max(0, prev - txLimit))}
                  disabled={txOffset === 0 || txLoading}
                  className="p-1.5 rounded text-bambu-gray hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  aria-label={t('finance.prev', 'Previous')}
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-bambu-gray px-1 whitespace-nowrap">
                  {t('finance.pageNumberOf', 'Page {{page}} of {{total}}', { page: txPage, total: txTotalPages })}
                </span>
                <button
                  type="button"
                  onClick={() => setTxOffset((prev) => prev + txLimit)}
                  disabled={txLoading || txPage >= txTotalPages}
                  className="p-1.5 rounded text-bambu-gray hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  aria-label={t('finance.next', 'Next')}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setTxOffset(Math.max(0, (txTotalPages - 1) * txLimit))}
                  disabled={txLoading || txPage >= txTotalPages}
                  className="p-1.5 rounded text-bambu-gray hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  aria-label={t('finance.last', 'Last')}
                >
                  <ChevronsRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            <p className="text-xs text-bambu-gray">
              {t('finance.pageRange', 'Offset {{offset}}', { offset: txOffset })}
            </p>

            {txLoading && <p className="text-sm text-bambu-gray">{t('common.loading', 'Loading...')}</p>}
            {!txLoading && (!transactions || transactions.length === 0) && (
              <p className="text-sm text-bambu-gray">{t('finance.noTransactions', 'No transactions available.')}</p>
            )}
            {!txLoading && transactions.length > 0 && filteredTransactions.length === 0 && (
              <p className="text-sm text-bambu-gray">{t('finance.noTransactionsForFilter', 'No transactions match the selected filters.')}</p>
            )}
            {!txLoading && filteredTransactions.length > 0 && (
              <div className="overflow-auto rounded-lg border border-bambu-dark-tertiary">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-bambu-dark-tertiary bg-bambu-dark text-bambu-gray">
                        <th className={tableHeadCellClass}>{t('common.date', 'Date')}</th>
                        <th className={tableHeadCellClass}>{t('finance.transactionType', 'Type')}</th>
                        <th className={tableHeadCellClass}>{t('finance.amount', 'Amount')}</th>
                        <th className={tableHeadCellClass}>{t('finance.balanceAfter', 'Balance after')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTransactions.map((tx) => {
                      const positive = tx.amount >= 0;
                      return (
                        <tr key={tx.id} className="border-b border-bambu-dark-tertiary/60 text-white">
                            <td className={tableCellClass}>{formatTimestamp(tx.created_at, i18n.language)}</td>
                            <td className={tableCellClass + ' capitalize'}>{tx.transaction_type}</td>
                            <td className={`${tableCellClass} ${positive ? 'text-green-400' : 'text-red-400'}`}>
                            {positive ? '+' : '-'}{currencySymbol}{Math.abs(tx.amount).toFixed(2)}
                          </td>
                            <td className={tableCellClass}>{tx.balance_after == null ? '-' : `${currencySymbol}${tx.balance_after.toFixed(2)}`}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
