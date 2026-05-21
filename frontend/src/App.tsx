import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';
import NavBar from './components/NavBar';
import RouteMap from './components/RouteMap';
import ReviewPage from './pages/ReviewPage';

function App() {
  return (
    <BrowserRouter>
      <NavBar />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Routes>
          <Route path="/" element={<RouteMap />} />
          <Route path="/review" element={<ReviewPage />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}

export default App;
