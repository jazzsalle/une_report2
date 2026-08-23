import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SitHome } from './sit/SitHome';
import { Trash } from './Trash';
import { SitOrg } from './sit/SitOrg';
import { WeatherPage } from './WeatherPage';
import { Home } from './Home';
import { PlanShell } from './plan/PlanShell';
import { PlanList } from './plan/PlanList';
import { PlanTemplates } from './plan/PlanTemplates';
import { PlanBasisTemplates } from './plan/PlanBasisTemplates';
import { PlanBasisTemplateDetail } from './plan/PlanBasisTemplateDetail';
import { PlanEditor } from './plan/PlanEditor';
import { PlanRhwpEditor } from './plan/PlanRhwpEditor';
import { SitShell } from './sit/SitShell';
import { SitDashboard } from './sit/SitDashboard';
import { SitNew } from './sit/SitNew';
import { SitSop } from './sit/SitSop';
import { SitDispatch } from './sit/SitDispatch';
import { SitBoard } from './sit/SitBoard';
import { SitReports } from './sit/SitReports';
import { SitManuals } from './sit/SitManuals';
import { Mobile } from './sit/Mobile';
import { font } from './ui';

document.body.style.margin = '0';
document.body.style.fontFamily = font;
document.body.style.background = '#f4f5f6';
document.body.style.color = '#1f2933';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/plan" element={<PlanShell />}>
          <Route index element={<PlanList />} />
          <Route path="templates" element={<PlanTemplates />} />
          <Route path="basis-templates" element={<PlanBasisTemplates />} />
          <Route path="basis-templates/:id" element={<PlanBasisTemplateDetail />} />
          <Route path="trash" element={<Trash scope="plan" />} />
          <Route path=":id" element={<PlanEditor />} />
          <Route path=":id/editor" element={<PlanRhwpEditor />} />
        </Route>
        <Route path="/sit" element={<SitShell />}>
          <Route index element={<SitHome />} />
          <Route path="trash" element={<Trash scope="sit" />} />
          <Route path="new" element={<SitNew />} />
          <Route path="manuals" element={<SitManuals />} />
          <Route path="data" element={<Navigate to="/sit/manuals" replace />} />
          <Route path="settings" element={<SitOrg />} />
          <Route path=":id" element={<SitDashboard />} />
          <Route path=":id/sop" element={<SitSop />} />
          <Route path=":id/dispatch" element={<SitDispatch />} />
          <Route path=":id/board" element={<SitBoard />} />
          <Route path=":id/reports" element={<SitReports />} />
          <Route path=":id/journal" element={<SitReports />} />
        </Route>
        <Route path="/m/:assigneeId" element={<Mobile />} />
        <Route path="/weather" element={<WeatherPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
