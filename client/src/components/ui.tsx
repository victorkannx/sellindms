import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import type { Script } from '../types/domain';

export const Brand = ({ inverted = false }: { inverted?: boolean }) => (
  <Link className={`brand ${inverted ? 'brand--inverted' : ''}`} to="/" aria-label="Sell In DMs home">
    <span className="brand__mark" aria-hidden="true">↳</span>
    <span>Sell <em>In</em> DMs</span>
  </Link>
);

export const formatNaira = (amount: number) => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(amount);

export const SearchForm = ({ initialValue = '', compact = false, onSearch }: { initialValue?: string; compact?: boolean; onSearch: (value: string) => void }) => {
  const navigate = useNavigate();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get('query')?.toString().trim() || '';
    onSearch(value);
    navigate(`/app/search${value ? `?q=${encodeURIComponent(value)}` : ''}`);
  };
  return (
    <form className={`search-form ${compact ? 'search-form--compact' : ''}`} onSubmit={submit}>
      <span className="search-form__icon" aria-hidden="true">⌕</span>
      <input name="query" defaultValue={initialValue} placeholder="Search your DM situation..." aria-label="Search your DM situation" />
      <button type="submit">Search</button>
    </form>
  );
};

export const Chip = ({ children }: { children: ReactNode }) => <span className="chip">{children}</span>;

export const ScriptCard = ({ script, saved, onSave }: { script: Script; saved?: boolean; onSave?: (script: Script) => void }) => (
  <article className="script-card">
    <div className="script-card__topline">
      <div className="script-card__meta">
        {script.stage && <Chip>{script.stage.name}</Chip>}
        {script.category && <span>{script.category.name}</span>}
      </div>
      {onSave && <button className={`icon-button ${saved ? 'is-saved' : ''}`} onClick={() => onSave(script)} aria-label={saved ? `Remove ${script.title} from saved scripts` : `Save ${script.title}`}>{saved ? '★' : '☆'}</button>}
    </div>
    <Link to={`/app/scripts/${script.slug}`} className="script-card__link">
      <h3>{script.title}</h3>
      <p>{script.situation}</p>
      <div className="script-card__footer">
        <span>{script.niches.slice(0, 2).map((niche) => niche.name).join(' · ') || 'All niches'}</span>
        <span className="arrow-link">Open <b>→</b></span>
      </div>
    </Link>
  </article>
);

export const EmptyState = ({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) => (
  <div className="empty-state">
    <span className="empty-state__mark">↳</span>
    <h2>{title}</h2>
    <p>{children}</p>
    {action}
  </div>
);

export const LoadingState = ({ label = 'Loading' }: { label?: string }) => <div className="loading-state"><span className="spinner" />{label}</div>;

const mobileNavItems = [
  ['/app', 'Home'],
  ['/app/start-here', 'Start Here'],
  ['/app/search', 'Search'],
  ['/app/scripts', 'Browse Library'],
  ['/app/saved', 'Saved'],
  ['/app/recent', 'Recent'],
  ['/app/resources', 'Resources'],
  ['/app/account', 'Account'],
] as const;

export const MobileNav = () => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const closeMenu = () => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  return (
    <div className="mobile-nav">
      <header className="mobile-app-header">
        <Brand />
        <button ref={triggerRef} className={`mobile-menu-toggle ${open ? 'is-open' : ''}`} type="button" aria-label={open ? 'Close navigation menu' : 'Open navigation menu'} aria-expanded={open} aria-controls="mobile-customer-menu" onClick={() => open ? closeMenu() : setOpen(true)}>
          <span /><span /><span />
        </button>
      </header>
      {open && <div className="mobile-menu-layer" onClick={closeMenu}>
        <aside id="mobile-customer-menu" className="mobile-menu" role="dialog" aria-modal="true" aria-label="Customer navigation" onClick={(event) => event.stopPropagation()}>
          <div className="mobile-menu__top"><span>MENU</span><button ref={closeRef} type="button" className="mobile-menu__close" aria-label="Close navigation menu" onClick={closeMenu}>×</button></div>
          <nav>
            {mobileNavItems.map(([to, label]) => <NavLink key={to} to={to} end={to === '/app'} onClick={closeMenu}>{label}<span aria-hidden="true">→</span></NavLink>)}
          </nav>
          <p>Find the next move. Keep the conversation clear.</p>
        </aside>
      </div>}
    </div>
  );
};

export const AppSidebar = ({ onSignOut }: { onSignOut: () => void }) => (
  <aside className="app-sidebar">
    <Brand />
    <nav className="sidebar-nav" aria-label="Customer navigation">
      <NavLink to="/app" end>Dashboard</NavLink>
      <NavLink to="/app/start-here">Start here</NavLink>
      <NavLink to="/app/search">Search</NavLink>
      <NavLink to="/app/scripts">Browse library</NavLink>
      <NavLink to="/app/saved">Saved</NavLink>
      <NavLink to="/app/recent">Recent</NavLink>
      <NavLink to="/app/resources">Resources</NavLink>
      <NavLink to="/app/account">Account</NavLink>
    </nav>
    <div className="sidebar-note"><span>FIELD GUIDE</span><p>Find the next move. Keep the conversation clear.</p></div>
    <button className="quiet-button" onClick={onSignOut}>Sign out <span>→</span></button>
  </aside>
);
