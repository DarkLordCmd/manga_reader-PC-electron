import { useSettings } from './settings/useSettings';
import ReadingSection from './settings/ReadingSection';
import CatalogSection from './settings/CatalogSection';
import DisplaySection from './settings/DisplaySection';
import DownloadsSection from './settings/DownloadsSection';
import LibMirrorsSection from './settings/LibMirrorsSection';
import CustomDnsSection from './settings/CustomDnsSection';
import LibrarySection from './settings/LibrarySection';
import SyncSection from './settings/SyncSection';
import BackupSection from './settings/BackupSection';
import NetworkSection from './settings/NetworkSection';
import EhAccountsSection from './settings/EhAccountsSection';
import CoverCacheSection from './settings/CoverCacheSection';
import PrivacySection from './settings/PrivacySection';
import SecuritySection from './settings/SecuritySection';

export default function Settings(): JSX.Element {
  const s = useSettings();

  return (
    <div className="screen">
      <div className="settings-scroll">
        <ReadingSection settings={s.settings} upd={s.upd} />
        <CatalogSection settings={s.settings} upd={s.upd} />
        <DisplaySection settings={s.settings} upd={s.upd} />
        <DownloadsSection settings={s.settings} upd={s.upd} />
        <LibMirrorsSection settings={s.settings} upd={s.upd} />
        <CustomDnsSection settings={s.settings} upd={s.upd} />
        <LibrarySection settings={s.settings} upd={s.upd} />
        <SyncSection
          settings={s.settings}
          upd={s.upd}
          google={s.google}
          setGoogle={s.setGoogle}
          syncState={s.syncState}
          syncMsg={s.syncMsg}
          setSyncMsg={s.setSyncMsg}
        />
        <BackupSection />
        <NetworkSection settings={s.settings} upd={s.upd} />
        <EhAccountsSection />
        <CoverCacheSection settings={s.settings} upd={s.upd} />
        <PrivacySection settings={s.settings} upd={s.upd} />
        <SecuritySection />
      </div>
    </div>
  );
}
