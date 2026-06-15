import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';
import NavBar from './components/NavBar';
import RouteMap from './components/RouteMap';
import ReviewPage from './pages/ReviewPage';

function App() {
  return (
    <BrowserRouter>
      <div className="h-screen flex flex-col bg-background overflow-hidden">
        <NavBar />
        <main className="flex-1 flex flex-col overflow-hidden">
          <Routes>
            <Route path="/" element={<RouteMap />} />
            <Route path="/review" element={<ReviewPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
