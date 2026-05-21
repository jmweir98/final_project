import React from 'react';
import { Link, useLocation } from 'react-router-dom';

const NavBar: React.FC = () => {
  const location = useLocation();

  const linkStyle = (path: string): React.CSSProperties => ({
    color: location.pathname === path ? 'white' : 'rgba(255,255,255,0.72)',
    textDecoration: 'none',
    fontSize: '15px',
    fontWeight: location.pathname === path ? 600 : 400,
    padding: '6px 12px',
    borderRadius: '6px',
    background: location.pathname === path ? 'rgba(255,255,255,0.15)' : 'transparent',
    transition: 'all 0.15s',
  });

  return (
    <nav style={{
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      padding: '0 28px',
      display: 'flex',
      alignItems: 'center',
      height: '58px',
      boxShadow: '0 2px 12px rgba(0,0,0,0.18)',
      position: 'sticky',
      top: 0,
      zIndex: 1000,
      flexShrink: 0,
    }}>
      <Link to="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontSize: '22px', fontWeight: 700, color: 'white', letterSpacing: '-0.3px' }}>
          AccessRoute
        </span>
        <span style={{
          fontSize: '11px',
          fontWeight: 500,
          color: 'rgba(255,255,255,0.7)',
          background: 'rgba(255,255,255,0.15)',
          padding: '2px 8px',
          borderRadius: '20px',
          letterSpacing: '0.5px',
          textTransform: 'uppercase',
        }}>
          Belfast
        </span>
      </Link>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px' }}>
        <Link to="/" style={linkStyle('/')}>Route Planner</Link>
      </div>
    </nav>
  );
};

export default NavBar;
