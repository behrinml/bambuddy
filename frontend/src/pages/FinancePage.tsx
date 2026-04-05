import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Clock3, Wallet } from 'lucide-react';
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

export function FinancePage() {
  const { t, i18n } = useTranslation();
  const { hasPermission } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const canReadOwn = hasPermission('finance:read_own');
  const canReadAll = hasPermission('finance:read_all');
  const canReadCostCenters = hasPermission('finance:cost_centers:read');
  const canCreateCostCenters = hasPermission('finance:cost_centers:create');
  const canUpdateBudgets = hasPermission('finance:budgets:update');
  const canAdjustWallet = hasPermission('finance:transactions:create');
  const canReadUsers = hasPermission('users:read');

  const canAccessFinance = canReadOwn || canReadCostCenters;

  const [newCenterName, setNewCenterName] = useState('');
  const [newCenterTotalBudget, setNewCenterTotalBudget] = useState('');
  const [newCenterMonthlyBudget, setNewCenterMonthlyBudget] = useState('');

  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [selectedAdjustmentType, setSelectedAdjustmentType] = useState<'deposit' | 'withdraw'>('deposit');
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  const [adjustmentDescription, setAdjustmentDescription] = useState('');
  const [adjustmentCostCenterId, setAdjustmentCostCenterId] = useState<number | null>(null);

  const [budgetDrafts, setBudgetDrafts] = useState<Record<number, { total: string; monthly: string }>>({});

  const { data: wallet, isLoading: walletLoading } = useQuery({
    queryKey: ['finance', 'me', 'balance'],
    queryFn: api.getMyBalance,
    enabled: canReadOwn,
  });

  const { data: transactions, isLoading: txLoading } = useQuery({
    queryKey: ['finance', 'me', 'transactions'],
    queryFn: () => api.getMyTransactions(100, 0),
    enabled: canReadOwn,
  });

  const { data: costCenters, isLoading: centersLoading } = useQuery({
    queryKey: ['finance', 'cost-centers', canUpdateBudgets || canCreateCostCenters ? 'all' : 'mine'],
    queryFn: () => (canUpdateBudgets || canCreateCostCenters ? api.listCostCenters(true) : api.getMyCostCenters()),
    enabled: canReadCostCenters,
  });

  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: api.getUsers,
    enabled: canAdjustWallet && canReadUsers,
  });

  useEffect(() => {
    if (!costCenters || costCenters.length === 0) return;
    const next: Record<number, { total: string; monthly: string }> = {};
    for (const center of costCenters) {
      next[center.id] = {
        total: center.total_budget == null ? '' : String(center.total_budget),
        monthly: center.monthly_budget == null ? '' : String(center.monthly_budget),
      };
    }
    setBudgetDrafts(next);
  }, [costCenters]);

  useEffect(() => {
    if (!users || users.length === 0) return;
    if (selectedUserId != null && users.some((u) => u.id === selectedUserId)) return;
    setSelectedUserId(users[0].id);
  }, [users, selectedUserId]);

  const createCostCenterMutation = useMutation({
    mutationFn: () =>
      api.createCostCenter({
        name: newCenterName.trim(),
        total_budget: parseBudgetValue(newCenterTotalBudget),
        monthly_budget: parseBudgetValue(newCenterMonthlyBudget),
        is_active: true,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance'] });
      setNewCenterName('');
      setNewCenterTotalBudget('');
      setNewCenterMonthlyBudget('');
      showToast(t('finance.createdCostCenter', 'Cost center created'));
    },
    onError: (error: Error) => {
      showToast(error.message || t('finance.createCostCenterFailed', 'Failed to create cost center'), 'error');
    },
  });

  const updateBudgetMutation = useMutation({
    mutationFn: ({ costCenterId, total, monthly }: { costCenterId: number; total: string; monthly: string }) =>
      api.updateCostCenterBudgets(costCenterId, {
        total_budget: parseBudgetValue(total),
        monthly_budget: parseBudgetValue(monthly),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance'] });
      showToast(t('finance.budgetsSaved', 'Budgets saved'));
    },
    onError: (error: Error) => {
      showToast(error.message || t('finance.budgetSaveFailed', 'Failed to save budgets'), 'error');
    },
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

  const isAdjustingWallet = depositMutation.isPending || withdrawMutation.isPending;

  const handleCreateCostCenter = () => {
    if (!newCenterName.trim()) {
      showToast(t('finance.costCenterNameRequired', 'Cost center name is required'), 'error');
      return;
    }
    createCostCenterMutation.mutate();
  };

  const handleSaveBudgets = (costCenterId: number) => {
    const draft = budgetDrafts[costCenterId];
    if (!draft) return;
    updateBudgetMutation.mutate({ costCenterId, total: draft.total, monthly: draft.monthly });
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

  const currency = wallet?.currency || 'EUR';
  const currencySymbol = getCurrencySymbol(currency);

  const sortedUsers = useMemo(() => {
    return [...(users || [])].sort((a, b) => a.username.localeCompare(b.username));
  }, [users]);

  if (!canAccessFinance) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-white">{t('finance.title', 'Finance')}</h1>
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
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">{t('finance.title', 'Finance')}</h1>
        <p className="text-bambu-gray mt-1">{t('finance.subtitle', 'Wallet, transactions, and cost centers')}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <span className="text-sm text-bambu-gray">{t('finance.currentBalance', 'Current balance')}</span>
            <Wallet className="w-4 h-4 text-bambu-green" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-white">
              {walletLoading ? t('common.loading', 'Loading...') : `${currencySymbol}${(wallet?.balance ?? 0).toFixed(2)}`}
            </p>
            <p className="text-xs text-bambu-gray mt-2">
              {t('finance.lastUpdated', 'Updated')}: {formatTimestamp(wallet?.updated_at ?? null, i18n.language)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <span className="text-sm text-bambu-gray">{t('finance.transactions', 'Transactions')}</span>
            <Clock3 className="w-4 h-4 text-blue-400" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-white">{txLoading ? '-' : transactions?.length ?? 0}</p>
            <p className="text-xs text-bambu-gray mt-2">{t('finance.last100', 'Last 100 entries')}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <span className="text-sm text-bambu-gray">{t('finance.costCenters', 'Cost centers')}</span>
            <Building2 className="w-4 h-4 text-orange-400" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-white">{centersLoading ? '-' : costCenters?.length ?? 0}</p>
            <p className="text-xs text-bambu-gray mt-2">{t('finance.availableForPrinting', 'Available for print assignment')}</p>
          </CardContent>
        </Card>
      </div>

      {canCreateCostCenters && (
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold text-white">{t('finance.createCostCenter', 'Create cost center')}</h2>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              <input
                type="text"
                value={newCenterName}
                onChange={(e) => setNewCenterName(e.target.value)}
                placeholder={t('finance.costCenterName', 'Name')}
                className="px-3 py-2 text-sm bg-bambu-dark border border-bambu-dark-tertiary rounded text-white focus:outline-none focus:ring-1 focus:ring-bambu-green"
              />
              <input
                type="number"
                step="0.01"
                value={newCenterTotalBudget}
                onChange={(e) => setNewCenterTotalBudget(e.target.value)}
                placeholder={t('finance.totalBudget', 'Total budget')}
                className="px-3 py-2 text-sm bg-bambu-dark border border-bambu-dark-tertiary rounded text-white focus:outline-none focus:ring-1 focus:ring-bambu-green"
              />
              <input
                type="number"
                step="0.01"
                value={newCenterMonthlyBudget}
                onChange={(e) => setNewCenterMonthlyBudget(e.target.value)}
                placeholder={t('finance.monthlyBudget', 'Monthly budget')}
                className="px-3 py-2 text-sm bg-bambu-dark border border-bambu-dark-tertiary rounded text-white focus:outline-none focus:ring-1 focus:ring-bambu-green"
              />
            </div>
            <Button onClick={handleCreateCostCenter} disabled={createCostCenterMutation.isPending}>
              {createCostCenterMutation.isPending ? t('common.saving', 'Saving...') : t('finance.create', 'Create')}
            </Button>
          </CardContent>
        </Card>
      )}

      {canAdjustWallet && canReadUsers && (
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold text-white">{t('finance.adjustWallet', 'Adjust wallet')}</h2>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <select
                value={selectedUserId ?? ''}
                onChange={(e) => setSelectedUserId(e.target.value ? Number(e.target.value) : null)}
                className="px-3 py-2 text-sm bg-bambu-dark border border-bambu-dark-tertiary rounded text-white focus:outline-none focus:ring-1 focus:ring-bambu-green"
              >
                {(sortedUsers || []).map((u) => (
                  <option key={u.id} value={u.id}>{u.username}</option>
                ))}
              </select>

              <select
                value={selectedAdjustmentType}
                onChange={(e) => setSelectedAdjustmentType(e.target.value as 'deposit' | 'withdraw')}
                className="px-3 py-2 text-sm bg-bambu-dark border border-bambu-dark-tertiary rounded text-white focus:outline-none focus:ring-1 focus:ring-bambu-green"
              >
                <option value="deposit">{t('finance.deposit', 'Deposit')}</option>
                <option value="withdraw">{t('finance.withdraw', 'Withdraw')}</option>
              </select>

              <input
                type="number"
                step="0.01"
                min="0"
                value={adjustmentAmount}
                onChange={(e) => setAdjustmentAmount(e.target.value)}
                placeholder={t('finance.amount', 'Amount')}
                className="px-3 py-2 text-sm bg-bambu-dark border border-bambu-dark-tertiary rounded text-white focus:outline-none focus:ring-1 focus:ring-bambu-green"
              />

              <select
                value={adjustmentCostCenterId ?? ''}
                onChange={(e) => setAdjustmentCostCenterId(e.target.value ? Number(e.target.value) : null)}
                className="px-3 py-2 text-sm bg-bambu-dark border border-bambu-dark-tertiary rounded text-white focus:outline-none focus:ring-1 focus:ring-bambu-green"
              >
                <option value="">{t('finance.noCostCenter', 'No cost center')}</option>
                {(costCenters || []).map((center) => (
                  <option key={center.id} value={center.id}>{center.name}</option>
                ))}
              </select>
            </div>

            <input
              type="text"
              value={adjustmentDescription}
              onChange={(e) => setAdjustmentDescription(e.target.value)}
              placeholder={t('finance.descriptionOptional', 'Description (optional)')}
              className="w-full px-3 py-2 text-sm bg-bambu-dark border border-bambu-dark-tertiary rounded text-white focus:outline-none focus:ring-1 focus:ring-bambu-green"
            />

            <Button onClick={handleWalletAdjustment} disabled={isAdjustingWallet}>
              {isAdjustingWallet ? t('common.saving', 'Saving...') : t('finance.applyAdjustment', 'Apply adjustment')}
            </Button>
          </CardContent>
        </Card>
      )}

      {canReadCostCenters && (
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold text-white">{t('finance.myCostCenters', 'My cost centers')}</h2>
          </CardHeader>
          <CardContent className="space-y-2">
            {centersLoading && <p className="text-sm text-bambu-gray">{t('common.loading', 'Loading...')}</p>}
            {!centersLoading && (!costCenters || costCenters.length === 0) && (
              <p className="text-sm text-bambu-gray">{t('finance.noCostCenters', 'No cost centers found.')}</p>
            )}
            {!centersLoading && costCenters && costCenters.length > 0 && (
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-bambu-dark-tertiary text-bambu-gray">
                      <th className="text-left py-2 pr-3">{t('common.name', 'Name')}</th>
                      <th className="text-left py-2 pr-3">{t('finance.type', 'Type')}</th>
                      <th className="text-left py-2 pr-3">{t('finance.totalBudget', 'Total budget')}</th>
                      <th className="text-left py-2 pr-3">{t('finance.monthlyBudget', 'Monthly budget')}</th>
                      {canUpdateBudgets && <th className="text-left py-2">{t('common.actions', 'Actions')}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {costCenters.map((center) => {
                      const draft = budgetDrafts[center.id] || { total: '', monthly: '' };
                      return (
                        <tr key={center.id} className="border-b border-bambu-dark-tertiary/60 text-white">
                          <td className="py-2 pr-3">{center.name}</td>
                          <td className="py-2 pr-3">{center.is_private ? t('finance.personal', 'Personal') : t('finance.shared', 'Shared')}</td>
                          <td className="py-2 pr-3">
                            {canUpdateBudgets ? (
                              <input
                                type="number"
                                step="0.01"
                                value={draft.total}
                                onChange={(e) =>
                                  setBudgetDrafts((prev) => ({
                                    ...prev,
                                    [center.id]: { ...draft, total: e.target.value },
                                  }))
                                }
                                className="w-32 px-2 py-1 text-sm bg-bambu-dark border border-bambu-dark-tertiary rounded text-white"
                              />
                            ) : center.total_budget == null ? '-' : `${currencySymbol}${center.total_budget.toFixed(2)}`}
                          </td>
                          <td className="py-2 pr-3">
                            {canUpdateBudgets ? (
                              <input
                                type="number"
                                step="0.01"
                                value={draft.monthly}
                                onChange={(e) =>
                                  setBudgetDrafts((prev) => ({
                                    ...prev,
                                    [center.id]: { ...draft, monthly: e.target.value },
                                  }))
                                }
                                className="w-32 px-2 py-1 text-sm bg-bambu-dark border border-bambu-dark-tertiary rounded text-white"
                              />
                            ) : center.monthly_budget == null ? '-' : `${currencySymbol}${center.monthly_budget.toFixed(2)}`}
                          </td>
                          {canUpdateBudgets && (
                            <td className="py-2">
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => handleSaveBudgets(center.id)}
                                disabled={updateBudgetMutation.isPending}
                              >
                                {t('common.save', 'Save')}
                              </Button>
                            </td>
                          )}
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

      {(canReadOwn || canReadAll) && (
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold text-white">{t('finance.recentTransactions', 'Recent transactions')}</h2>
          </CardHeader>
          <CardContent className="space-y-2">
            {txLoading && <p className="text-sm text-bambu-gray">{t('common.loading', 'Loading...')}</p>}
            {!txLoading && (!transactions || transactions.length === 0) && (
              <p className="text-sm text-bambu-gray">{t('finance.noTransactions', 'No transactions available.')}</p>
            )}
            {!txLoading && transactions && transactions.length > 0 && (
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-bambu-dark-tertiary text-bambu-gray">
                      <th className="text-left py-2 pr-3">{t('common.date', 'Date')}</th>
                      <th className="text-left py-2 pr-3">{t('finance.transactionType', 'Type')}</th>
                      <th className="text-left py-2 pr-3">{t('finance.amount', 'Amount')}</th>
                      <th className="text-left py-2">{t('finance.balanceAfter', 'Balance after')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((tx) => {
                      const positive = tx.amount >= 0;
                      return (
                        <tr key={tx.id} className="border-b border-bambu-dark-tertiary/60 text-white">
                          <td className="py-2 pr-3">{formatTimestamp(tx.created_at, i18n.language)}</td>
                          <td className="py-2 pr-3 capitalize">{tx.transaction_type}</td>
                          <td className={`py-2 pr-3 ${positive ? 'text-green-400' : 'text-red-400'}`}>
                            {positive ? '+' : '-'}{currencySymbol}{Math.abs(tx.amount).toFixed(2)}
                          </td>
                          <td className="py-2">{tx.balance_after == null ? '-' : `${currencySymbol}${tx.balance_after.toFixed(2)}`}</td>
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
  );
}
