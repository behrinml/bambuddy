import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Search, X, Filter, Package } from 'lucide-react';
import { api } from '../../api/client';
import type { InventorySpool } from '../../api/client';
import { resolveSpoolColorName } from '../../utils/colors';

type MaterialFilter = string | null;
type SortKey = 'name' | 'material' | 'remaining' | 'recent';

const MATERIAL_COLORS: Record<string, string> = {
  PLA: 'bg-green-500/20 text-green-400 border-green-500/30',
  ABS: 'bg-red-500/20 text-red-400 border-red-500/30',
  PETG: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  TPU: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  ASA: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  PA: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  PC: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  PET: 'bg-sky-500/20 text-sky-400 border-sky-500/30',
  PVA: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  HIPS: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
};

function getMaterialPillClass(material: string): string {
  const base = material.split('-')[0].split(' ')[0].toUpperCase();
  return MATERIAL_COLORS[base] || 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30';
}

function spoolColor(spool: InventorySpool): string {
  if (spool.rgba) return `#${spool.rgba.substring(0, 6)}`;
  return '#808080';
}

function spoolRemaining(spool: InventorySpool): number {
  return Math.max(0, spool.label_weight - spool.weight_used);
}

function spoolPct(spool: InventorySpool): number {
  if (spool.label_weight <= 0) return 0;
  return Math.max(0, Math.min(100, ((spool.label_weight - spool.weight_used) / spool.label_weight) * 100));
}

function spoolDisplayName(spool: InventorySpool): string {
  const parts = [spool.material];
  if (spool.subtype) parts.push(spool.subtype);
  return parts.join(' ');
}

export function SpoolBuddyInventoryPage() {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [materialFilter, setMaterialFilter] = useState<MaterialFilter>(null);
  const [sortKey, setSortKey] = useState<SortKey>('recent');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedSpool, setSelectedSpool] = useState<InventorySpool | null>(null);

  // Check if Spoolman is enabled — if so, show iframe
  const { data: spoolmanSettings } = useQuery({
    queryKey: ['spoolman-settings'],
    queryFn: api.getSpoolmanSettings,
    staleTime: 5 * 60 * 1000,
  });

  const { data: spools = [], isLoading } = useQuery({
    queryKey: ['inventory-spools'],
    queryFn: () => api.getSpools(false),
    refetchInterval: 30000,
  });

  // Spoolman iframe mode
  const spoolmanEnabled = spoolmanSettings?.spoolman_enabled === 'true' && spoolmanSettings?.spoolman_url;
  if (spoolmanEnabled) {
    return (
      <div className="h-full flex flex-col">
        <iframe
          src={`${spoolmanSettings.spoolman_url.replace(/\/+$/, '')}/spool`}
          className="flex-1 w-full border-0"
          title="Spoolman"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
        />
      </div>
    );
  }

  // Collect unique materials for filter chips
  const materials = useMemo(() => {
    const set = new Set<string>();
    spools.forEach(s => set.add(s.material));
    return Array.from(set).sort();
  }, [spools]);

  // Filter and sort
  const filteredSpools = useMemo(() => {
    let list = spools.filter(s => !s.archived_at);

    if (materialFilter) {
      list = list.filter(s => s.material === materialFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(s =>
        s.material.toLowerCase().includes(q) ||
        (s.subtype && s.subtype.toLowerCase().includes(q)) ||
        (s.brand && s.brand.toLowerCase().includes(q)) ||
        (s.color_name && s.color_name.toLowerCase().includes(q)) ||
        (s.note && s.note.toLowerCase().includes(q))
      );
    }

    // Sort
    list = [...list];
    switch (sortKey) {
      case 'name':
        list.sort((a, b) => spoolDisplayName(a).localeCompare(spoolDisplayName(b)));
        break;
      case 'material':
        list.sort((a, b) => a.material.localeCompare(b.material) || spoolDisplayName(a).localeCompare(spoolDisplayName(b)));
        break;
      case 'remaining':
        list.sort((a, b) => spoolPct(a) - spoolPct(b));
        break;
      case 'recent':
      default:
        list.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
        break;
    }

    return list;
  }, [spools, materialFilter, searchQuery, sortKey]);

  return (
    <div className="h-full flex flex-col">
      {/* Search bar */}
      <div className="px-3 pt-3 pb-2 space-y-2">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={t('spoolbuddy.inventory.searchPlaceholder', 'Search spools...')}
              className="w-full pl-9 pr-8 py-2 bg-bambu-dark-secondary border border-bambu-dark-tertiary rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-bambu-green"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/60"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`px-3 py-2 rounded-lg border transition-colors ${
              showFilters || materialFilter
                ? 'bg-bambu-green/20 border-bambu-green text-bambu-green'
                : 'bg-bambu-dark-secondary border-bambu-dark-tertiary text-white/50 hover:text-white/70'
            }`}
          >
            <Filter className="w-4 h-4" />
          </button>
        </div>

        {/* Filter panel */}
        {showFilters && (
          <div className="space-y-2">
            {/* Material chips */}
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setMaterialFilter(null)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                  !materialFilter
                    ? 'bg-bambu-green/20 text-bambu-green border-bambu-green/40'
                    : 'bg-bambu-dark-secondary text-white/50 border-bambu-dark-tertiary hover:text-white/70'
                }`}
              >
                {t('spoolbuddy.inventory.all', 'All')}
              </button>
              {materials.map(mat => (
                <button
                  key={mat}
                  onClick={() => setMaterialFilter(materialFilter === mat ? null : mat)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                    materialFilter === mat
                      ? getMaterialPillClass(mat)
                      : 'bg-bambu-dark-secondary text-white/50 border-bambu-dark-tertiary hover:text-white/70'
                  }`}
                >
                  {mat}
                </button>
              ))}
            </div>

            {/* Sort */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/40">{t('spoolbuddy.inventory.sortBy', 'Sort:')}</span>
              <div className="flex gap-1">
                {([
                  ['recent', t('spoolbuddy.inventory.sortRecent', 'Recent')],
                  ['name', t('spoolbuddy.inventory.sortName', 'Name')],
                  ['material', t('spoolbuddy.inventory.sortMaterial', 'Material')],
                  ['remaining', t('spoolbuddy.inventory.sortRemaining', 'Low Stock')],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setSortKey(key)}
                    className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                      sortKey === key
                        ? 'bg-bambu-green/20 text-bambu-green'
                        : 'text-white/40 hover:text-white/60'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Results count */}
      <div className="px-3 pb-2 flex items-center justify-between">
        <span className="text-xs text-white/40">
          {filteredSpools.length} {filteredSpools.length === 1 ? 'spool' : 'spools'}
        </span>
      </div>

      {/* Spool grid */}
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-bambu-green border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredSpools.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-white/30">
            <Package className="w-12 h-12 mb-3" />
            <p className="text-sm">
              {searchQuery || materialFilter
                ? t('spoolbuddy.inventory.noResults', 'No spools match your filters')
                : t('spoolbuddy.inventory.empty', 'No spools in inventory')}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {filteredSpools.map(spool => (
              <CompactSpoolCard
                key={spool.id}
                spool={spool}
                onClick={() => setSelectedSpool(spool)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selectedSpool && (
        <SpoolDetailModal
          spool={selectedSpool}
          onClose={() => setSelectedSpool(null)}
        />
      )}
    </div>
  );
}

/* Compact spool card for the grid */
function CompactSpoolCard({ spool, onClick }: { spool: InventorySpool; onClick: () => void }) {
  const color = spoolColor(spool);
  const pct = spoolPct(spool);
  const remaining = spoolRemaining(spool);
  const colorName = resolveSpoolColorName(spool.color_name, spool.rgba);

  return (
    <button
      onClick={onClick}
      className="bg-bambu-dark-secondary rounded-lg border border-bambu-dark-tertiary hover:border-bambu-green/60 transition-colors text-left overflow-hidden"
    >
      {/* Color banner */}
      <div className="h-8 relative" style={{ backgroundColor: color }}>
        {colorName && (
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="bg-black/50 text-white text-[10px] px-1.5 py-0.5 rounded-full truncate max-w-[90%]">
              {colorName}
            </span>
          </span>
        )}
      </div>

      <div className="p-2 space-y-1.5">
        {/* Material + subtype */}
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border shrink-0 ${getMaterialPillClass(spool.material)}`}>
            {spool.material}
          </span>
          {spool.subtype && (
            <span className="text-[11px] text-white/50 truncate">{spool.subtype}</span>
          )}
        </div>

        {/* Brand */}
        {spool.brand && (
          <p className="text-[11px] text-white/40 truncate">{spool.brand}</p>
        )}

        {/* Remaining bar */}
        <div className="flex items-center gap-1.5">
          <div className="flex-1 h-1.5 bg-bambu-dark-tertiary rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${pct > 50 ? 'bg-bambu-green' : pct > 20 ? 'bg-yellow-500' : 'bg-red-500'}`}
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
          <span className="text-[10px] text-white/40 min-w-[32px] text-right">{Math.round(remaining)}g</span>
        </div>
      </div>
    </button>
  );
}

/* Full detail modal */
function SpoolDetailModal({ spool, onClose }: { spool: InventorySpool; onClose: () => void }) {
  const { t } = useTranslation();
  const color = spoolColor(spool);
  const pct = spoolPct(spool);
  const remaining = spoolRemaining(spool);
  const colorName = resolveSpoolColorName(spool.color_name, spool.rgba);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Sheet */}
      <div
        className="relative w-full max-h-[85vh] bg-bambu-dark rounded-t-2xl overflow-y-auto animate-slide-up"
        onClick={e => e.stopPropagation()}
      >
        {/* Color header */}
        <div className="h-20 relative" style={{ backgroundColor: color }}>
          <button
            onClick={onClose}
            className="absolute top-3 right-3 bg-black/40 hover:bg-black/60 text-white rounded-full p-1.5 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="absolute bottom-3 left-4">
            <span className="bg-black/50 text-white text-sm px-2.5 py-1 rounded-full">
              {colorName || t('spoolbuddy.inventory.unknownColor', 'Unknown Color')}
            </span>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {/* Title row */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">
                {spoolDisplayName(spool)}
              </h2>
              {spool.brand && (
                <p className="text-sm text-white/50">{spool.brand}</p>
              )}
            </div>
            <span className="text-xs font-mono text-white/30 bg-bambu-dark-secondary px-2 py-1 rounded">
              #{spool.id}
            </span>
          </div>

          {/* Remaining bar */}
          <div>
            <div className="flex justify-between text-xs text-white/50 mb-1.5">
              <span>{t('spoolbuddy.inventory.remaining', 'Remaining')}</span>
              <span>{Math.round(pct)}%</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-3 bg-bambu-dark-secondary rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${pct > 50 ? 'bg-bambu-green' : pct > 20 ? 'bg-yellow-500' : 'bg-red-500'}`}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>
              <span className="text-sm font-medium text-white min-w-[48px] text-right">
                {Math.round(remaining)}g
              </span>
            </div>
          </div>

          {/* Detail grid */}
          <div className="grid grid-cols-2 gap-3">
            <DetailItem
              label={t('spoolbuddy.inventory.labelWeight', 'Label Weight')}
              value={`${spool.label_weight}g`}
            />
            <DetailItem
              label={t('spoolbuddy.inventory.weightUsed', 'Used')}
              value={spool.weight_used > 0 ? `${Math.round(spool.weight_used)}g` : '-'}
            />
            <DetailItem
              label={t('spoolbuddy.inventory.coreWeight', 'Core Weight')}
              value={spool.core_weight > 0 ? `${spool.core_weight}g` : '-'}
            />
            <DetailItem
              label={t('spoolbuddy.inventory.grossWeight', 'Gross Weight')}
              value={`${spool.label_weight + spool.core_weight}g`}
            />
            {spool.nozzle_temp_min != null && spool.nozzle_temp_max != null && (
              <DetailItem
                label={t('spoolbuddy.inventory.nozzleTemp', 'Nozzle Temp')}
                value={`${spool.nozzle_temp_min}-${spool.nozzle_temp_max}°C`}
              />
            )}
            {spool.cost_per_kg != null && spool.cost_per_kg > 0 && (
              <DetailItem
                label={t('spoolbuddy.inventory.costPerKg', 'Cost/kg')}
                value={`${spool.cost_per_kg.toFixed(2)}/kg`}
              />
            )}
            {spool.last_scale_weight != null && (
              <DetailItem
                label={t('spoolbuddy.inventory.lastScaleWeight', 'Scale Weight')}
                value={`${Math.round(spool.last_scale_weight)}g`}
              />
            )}
            {spool.tag_uid && (
              <DetailItem
                label={t('spoolbuddy.inventory.tagId', 'Tag')}
                value={spool.tag_uid}
                mono
              />
            )}
          </div>

          {/* Note */}
          {spool.note && (
            <div className="bg-bambu-dark-secondary rounded-lg p-3">
              <p className="text-xs text-white/40 mb-1">{t('spoolbuddy.inventory.note', 'Note')}</p>
              <p className="text-sm text-white/70">{spool.note}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-bambu-dark-secondary rounded-lg px-3 py-2">
      <p className="text-[10px] text-white/40 uppercase tracking-wide">{label}</p>
      <p className={`text-sm text-white mt-0.5 truncate ${mono ? 'font-mono text-xs' : ''}`}>{value}</p>
    </div>
  );
}
