import { Link, useLocation } from 'react-router-dom';
import { Accessibility } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const NavBar: React.FC = () => {
  const location = useLocation();

  return (
    <header className="sticky top-0 z-50 h-16 bg-card border-b border-border flex items-center px-5 shrink-0 shadow-sm">
      <Link to="/" className="flex items-center gap-2.5 no-underline">
        <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center shrink-0">
          <Accessibility className="h-5 w-5 text-primary-foreground" />
        </div>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-lg text-foreground tracking-tight">AccessRoute</span>
          <Badge variant="secondary" className="text-xs px-2 h-5">Belfast</Badge>
        </div>
      </Link>

      <nav className="ml-auto flex items-center gap-1">
        <Link
          to="/"
          className={cn(
            'px-4 py-2 rounded-md text-sm font-medium transition-colors no-underline',
            location.pathname === '/'
              ? 'bg-accent text-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent'
          )}
        >
          Route Planner
        </Link>
      </nav>
    </header>
  );
};

export default NavBar;
