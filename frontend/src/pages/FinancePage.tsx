import { useQuery } from '@tanstack/react-query';
import { Building2, Clock3, Wallet } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { Card, CardContent, CardHeader } from '../components/Card';
import { useAuth } from '../contexts/AuthContext';
import { getCurrencySymbol } from '../utils/currency';
import { parseUTCDate } from '../utils/date';

function formatTimestamp(value: string | null, locale: string): string {
  if (!value) return '-';
  const parsed = parseUTCDate(value);
  if (!parsed) return value;
  return parsed.toLocaleString(locale);
}

export function FinancePage() {
  const { t, i18n } = useTranslation();
  const { hasPermission } = useAuth();

  const canReadOwn = hasPermission('finance:read_own');
  const canReadCostCenters = hasPermission('finance:cost_centers:read');
  const canAccessFinance = canReadOwn || canReadCostCenters;

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
    queryKey: ['finance', 'cost-centers', 'mine'],
    queryFn: api.getMyCostCenters,
    enabled: canReadCostCenters,
  });

  const currency = wallet?.currency || 'EUR';
  const currencySymbol = getCurrencySymbol(currency);

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
                      <th className="text-left py-2">{t('finance.monthlyBudget', 'Monthly budget')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {costCenters.map((center) => (
                      <tr key={center.id} className="border-b border-bambu-dark-tertiary/60 text-white">
                        <td className="py-2 pr-3">{center.name}</td>
                        <td className="py-2 pr-3">{center.is_private ? t('finance.personal', 'Personal') : t('finance.shared', 'Shared')}</td>
                        <td className="py-2 pr-3">
                          {center.total_budget == null ? '-' : `${currencySymbol}${center.total_budget.toFixed(2)}`}
                        </td>
                        <td className="py-2">
                          {center.monthly_budget == null ? '-' : `${currencySymbol}${center.monthly_budget.toFixed(2)}`}
                        </td>
                      </tr>
                    ))}
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
