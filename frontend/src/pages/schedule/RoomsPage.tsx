/**
 * Rooms: the physical rooms of the centre, their equipment and how heavily
 * each one is used by groups. Rows link straight into the timetable filtered
 * to that room (/timetable?room=<id>).
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Button,
  Card,
  SearchInput,
  StatusBadge,
  Table,
  type TableColumn,
} from '../../components';
import { useAuth } from '../../auth/AuthContext';
import { humanise } from '../../utils/format';
import { FilterChips, ServerPagination, type FilterChipOption } from '../students/ui';
import { roomOptions, rooms, useApiQuery } from './api';
import type { Room } from './types';
import './schedule.css';

/** groups_count against capacity: a plain proportion bar, no colour guessing. */
function UtilisationBar({ groups, capacity }: { groups: number; capacity: number }): ReactNode {
  const safeCapacity = capacity > 0 ? capacity : 0;
  const ratio = safeCapacity === 0 ? 0 : Math.min(groups / safeCapacity, 1);
  return (
    <div className="sch-util">
      <span className="sch-util__track">
        <span className="sch-util__fill" style={{ width: `${ratio * 100}%` }} />
      </span>
      <span className="sch-util__label">
        {groups} group{groups === 1 ? '' : 's'} · {safeCapacity} seat{safeCapacity === 1 ? '' : 's'}
      </span>
    </div>
  );
}

export function RoomsPage(): ReactNode {
  const { hasPerm } = useAuth();
  const canView = hasPerm('rooms.view');

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    setPage(1);
  }, [search, status, pageSize]);

  const listQuery = useApiQuery(
    () => rooms({ search, status }),
    [search, status],
    canView,
  );

  // Distinct statuses actually present, so the chips never invent a value.
  const allRoomsQuery = useApiQuery(() => roomOptions(), [], canView);

  const statusOptions = useMemo<FilterChipOption[]>(() => {
    const values = new Set<string>();
    for (const room of allRoomsQuery.data ?? []) {
      const value = (room.status ?? '').trim();
      if (value !== '') values.add(value);
    }
    return Array.from(values)
      .sort()
      .map((value) => ({ value, label: humanise(value) }));
  }, [allRoomsQuery.data]);

  const rows = useMemo(() => listQuery.data?.results ?? [], [listQuery.data]);
  const totalPages = listQuery.data?.total_pages ?? 1;
  const totalItems = listQuery.data?.count ?? 0;
  const activePage = listQuery.data?.page ?? page;
  const activePageSize = listQuery.data?.page_size ?? pageSize;

  const columns: Array<TableColumn<Room>> = [
    {
      key: 'name',
      header: 'Room',
      width: '20%',
      sortValue: (room) => room.name,
      render: (room) => <strong>{room.name}</strong>,
    },
    {
      key: 'capacity',
      header: 'Capacity',
      align: 'right',
      sortValue: (room) => room.capacity,
      render: (room) => room.capacity,
    },
    {
      key: 'location',
      header: 'Location',
      render: (room) => (room.location === '' ? <span className="u-subtle">—</span> : room.location),
    },
    {
      key: 'equipment',
      header: 'Equipment',
      render: (room) =>
        room.equipment === '' ? <span className="u-subtle">—</span> : room.equipment,
    },
    {
      key: 'status',
      header: 'Status',
      sortValue: (room) => room.status,
      render: (room) => <StatusBadge status={room.status} />,
    },
    {
      key: 'groups_count',
      header: 'Groups',
      align: 'right',
      sortValue: (room) => room.groups_count,
      render: (room) => room.groups_count,
    },
    {
      key: 'utilisation',
      header: 'Utilisation',
      width: '18%',
      render: (room) => <UtilisationBar groups={room.groups_count} capacity={room.capacity} />,
    },
  ];

  return (
    <div>
      <header className="page-header">
        <div className="page-header__heading">
          <h1 className="page-header__title">Rooms</h1>
          <p className="page-header__subtitle">
            Every physical room, its capacity and equipment, and how many groups are booked into it.
            Open the timetable filtered to a room from its row.
          </p>
        </div>
        <div className="page-header__actions">
          <Button icon="refresh" onClick={listQuery.reload} loading={listQuery.loading}>
            Refresh
          </Button>
        </div>
      </header>

      {!canView ? (
        <div className="alert alert--warning" role="note" style={{ marginBottom: 'var(--space-4)' }}>
          <div className="alert__content">
            <span>
              Viewing rooms needs the <code>rooms.view</code> permission.
            </span>
          </div>
        </div>
      ) : null}

      <Card flush>
        <Table
          columns={columns}
          rows={rows}
          rowKey={(room) => room.id}
          paginated={false}
          dense
          loading={listQuery.loading}
          error={listQuery.error}
          onRetry={listQuery.reload}
          emptyTitle="No rooms found"
          emptyMessage={
            search !== '' || status !== ''
              ? 'Nothing matches the current search and status filter.'
              : 'No rooms have been created yet.'
          }
          emptyIcon="inbox"
          toolbar={
            <div className="u-row" style={{ flexWrap: 'wrap', width: '100%' }}>
              <span style={{ flex: '1 1 240px', maxWidth: 320 }}>
                <SearchInput
                  value={search}
                  onChange={setSearch}
                  placeholder="Search rooms…"
                  label="Search rooms"
                  small
                />
              </span>
              {statusOptions.length > 0 ? (
                <FilterChips
                  options={statusOptions}
                  value={status}
                  onChange={setStatus}
                  label="Filter rooms by status"
                />
              ) : null}
            </div>
          }
          actions={(room) => (
            <Link className="row-link" to={`/timetable?room=${room.id}`}>
              Timetable
            </Link>
          )}
          actionsHeader="Timetable"
          footer={
            rows.length > 0 ? (
              <ServerPagination
                page={activePage}
                totalPages={totalPages}
                count={totalItems}
                pageSize={activePageSize}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
                itemLabel="rooms"
              />
            ) : undefined
          }
        />
      </Card>
    </div>
  );
}

export default RoomsPage;
