import { errorText } from '../../lib/errors';
import { useEffect, useState } from 'react';
import Section, { Row, SubHead } from './Section';
import Toggle from '../../components/Toggle';
import type { ExAccountsResult } from '@shared/ipc';

export default function EhAccountsSection(): JSX.Element {
  const [exAcc, setExAcc] = useState<ExAccountsResult>({ accounts: [], currentId: 0 });
  const [exName, setExName] = useState('');
  const [exMemberId, setExMemberId] = useState('');
  const [exPassHash, setExPassHash] = useState('');
  const [exIgneous, setExIgneous] = useState('');
  const [exNotice, setExNotice] = useState<string | null>(null);
  const [pwUser, setPwUser] = useState('');
  const [pwPass, setPwPass] = useState('');
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);
  const [ckMember, setCkMember] = useState('');
  const [ckHash, setCkHash] = useState('');
  const [ckIgneous, setCkIgneous] = useState('');
  const [ckVerify, setCkVerify] = useState(true);
  const [ckMsg, setCkMsg] = useState<string | null>(null);
  const [ckBusy, setCkBusy] = useState(false);
  const [ckText, setCkText] = useState('');
  const [ignMsg, setIgnMsg] = useState<string | null>(null);
  const [ignBusy, setIgnBusy] = useState(false);
  const [limitBusy, setLimitBusy] = useState(false);
  const [limitMsg, setLimitMsg] = useState<string | null>(null);
  const [favBusy, setFavBusy] = useState(false);
  const [favMsg, setFavMsg] = useState<string | null>(null);

  useEffect(() => {
    window.api.getExAccounts().then(setExAcc);
  }, []);

  // Auto-detect E-Hentai cookies from the clipboard on open (like JHenTai).
  useEffect(() => {
    navigator.clipboard
      ?.readText?.()
      .then((t) => {
        if (!t) return;
        window.api
          .parseCookieText(t)
          .then((p) => {
            if (p.ipbMemberId || p.ipbPassHash || p.igneous) {
              if (p.ipbMemberId) setCkMember(p.ipbMemberId);
              if (p.ipbPassHash) setCkHash(p.ipbPassHash);
              if (p.igneous) setCkIgneous(p.igneous);
            }
          })
          .catch(() => {});
      })
      .catch(() => {});
  }, []);

  const recognizeCookies = async (text: string, clearText: boolean): Promise<void> => {
    setCkMsg(null);
    try {
      const p = await window.api.parseCookieText(text);
      if (!p.ipbMemberId && !p.ipbPassHash && !p.igneous) {
        setCkMsg('Куки E-Hentai не распознаны. Проверьте текст и попробуйте ещё раз.');
        return;
      }
      if (p.ipbMemberId) setCkMember(p.ipbMemberId);
      if (p.ipbPassHash) setCkHash(p.ipbPassHash);
      if (p.igneous) setCkIgneous(p.igneous);
      if (clearText) setCkText('');
      setCkMsg('Куки распознаны.');
    } catch (e) {
      setCkMsg(`Ошибка распознавания: ${errorText(e)}`);
    }
  };

  const canCookieLogin = !!ckMember.trim() && !!ckHash.trim() && !ckBusy;
  const canPasswordLogin = !!pwUser.trim() && !!pwPass && !pwBusy;
  const canAddAccount = !!exMemberId.trim() && !!exPassHash.trim();

  return (
    <Section title="Аккаунты ExHentai" desc="Активный аккаунт используется для всех запросов к ExHentai в обычном режиме.">
      <Row
        label="Лимит просмотра"
        note="E-Hentai разрешает сбросить лимит изображений со своего home.php (кнопка «Reset Limit»). Здесь отправляется тот же запрос с куками активного аккаунта."
      >
        <button
          disabled={limitBusy}
          onClick={async () => {
            setLimitBusy(true);
            setLimitMsg(null);
            try {
              const r = await window.api.ehResetImageLimit();
              setLimitMsg(r.message);
            } catch (e) {
              setLimitMsg(`Ошибка: ${errorText(e)}`);
            } finally {
              setLimitBusy(false);
            }
          }}
        >
          {limitBusy ? 'Сбрасываю…' : 'Сбросить лимит изображений'}
        </button>
      </Row>
      {limitMsg && (
        <Row stack>
          <span className="set-note">{limitMsg}</span>
        </Row>
      )}
      <SubHead>Избранное ExHentai</SubHead>
      <Row
        label="Импорт"
        note="Забирает избранное с аккаунта E-Hentai/ExHentai в локальную библиотеку (до 5 страниц за раз; повторный импорт не создаёт дублей)."
      >
        <button
          disabled={favBusy}
          onClick={async () => {
            setFavBusy(true);
            setFavMsg(null);
            let imported = 0;
            try {
              for (let page = 0; page < 5; page++) {
                const r = await window.api.ehFavorites(page);
                if (r.items.length === 0) break;
                for (const it of r.items) {
                  await window.api.libraryAddFavorite({
                    url: it.url,
                    title: it.title,
                    coverUrl: it.coverUrl,
                    source: 'ExHentai',
                    seriesId: it.url,
                  });
                  imported++;
                }
                if (!r.hasMore) break;
              }
              setFavMsg(imported > 0 ? `Импортировано: ${imported}` : 'На аккаунте нет избранного (или аккаунт не залогинен).');
            } catch (e) {
              setFavMsg(`Ошибка: ${errorText(e)}`);
            } finally {
              setFavBusy(false);
            }
          }}
        >
          {favBusy ? 'Импортирую…' : 'Импортировать избранное'}
        </button>
      </Row>
      {favMsg && (
        <Row stack>
          <span className="set-note">{favMsg}</span>
        </Row>
      )}
      <SubHead>Вход по куки</SubHead>
      <Row stack>
        <textarea
          className="cookie-input"
          aria-label="Куки E-Hentai для распознавания"
          rows={2}
          value={ckText}
          placeholder="Вставь куки (например, из буфера обмена) и нажми «Распознать»"
          onChange={(e) => setCkText(e.target.value)}
        />
      </Row>
      <Row>
        <button disabled={!ckText.trim()} onClick={() => void recognizeCookies(ckText, true)}>
          Распознать
        </button>
        <button
          onClick={async () => {
            try {
              const t = await navigator.clipboard?.readText?.();
              if (!t) {
                setCkMsg('Буфер обмена пуст.');
                return;
              }
              await recognizeCookies(t, false);
            } catch {
              setCkMsg('Не удалось прочитать буфер обмена.');
            }
          }}
        >
          Из буфера
        </button>
        <Toggle className="filter-check" checked={ckVerify} onChange={setCkVerify}>
          Проверять вход
        </Toggle>
      </Row>
      <Row label="ipb_member_id">
        <input aria-label="ipb_member_id" className="text-input" value={ckMember} onChange={(e) => setCkMember(e.target.value)} />
      </Row>
      <Row label="ipb_pass_hash">
        <input aria-label="ipb_pass_hash" className="text-input" value={ckHash} onChange={(e) => setCkHash(e.target.value)} />
      </Row>
      <Row label="igneous" note="Необязательно, только для ExHentai.">
        <input aria-label="igneous" className="text-input" value={ckIgneous} onChange={(e) => setCkIgneous(e.target.value)} />
      </Row>
      <Row label="Вход">
        <button
          className="set-primary"
          disabled={!canCookieLogin}
          onClick={async () => {
            if (!ckMember.trim() || !ckHash.trim()) return;
            setCkBusy(true);
            setCkMsg(null);
            try {
              const r = await window.api.cookieLogin({
                ipbMemberId: ckMember,
                ipbPassHash: ckHash,
                igneous: ckIgneous || null,
                verify: ckVerify,
              });
              setCkMsg(r.message);
              if (r.ok) setExAcc(await window.api.getExAccounts());
            } catch (e) {
              setCkMsg(`Ошибка: ${errorText(e)}`);
            } finally {
              setCkBusy(false);
            }
          }}
        >
          {ckBusy ? 'Вхожу…' : 'Войти по куки'}
        </button>
        <button
          disabled={ignBusy}
          title="Получить igneous из Set-Cookie exhentai.org"
          onClick={async () => {
            setIgnBusy(true);
            setIgnMsg(null);
            try {
              const r = await window.api.refreshIgneous();
              setIgnMsg(r.message);
              if (r.ok) setExAcc(await window.api.getExAccounts());
            } catch (e) {
              setIgnMsg(`Ошибка: ${errorText(e)}`);
            } finally {
              setIgnBusy(false);
            }
          }}
        >
          {ignBusy ? 'Получаю…' : 'Получить igneous'}
        </button>
      </Row>
      {ckMsg && (
        <Row stack>
          <span className="set-note" role="status" aria-live="polite">{ckMsg}</span>
        </Row>
      )}
      {ignMsg && (
        <Row stack>
          <span className="set-note" role="status" aria-live="polite">{ignMsg}</span>
        </Row>
      )}

      <SubHead>Логин и пароль</SubHead>
      <Row label="E-Hentai">
        <input
          className="text-input short"
          aria-label="Логин E-Hentai"
          placeholder="Логин"
          value={pwUser}
          onChange={(e) => setPwUser(e.target.value)}
        />
        <input
          className="text-input short"
          aria-label="Пароль E-Hentai"
          type="password"
          placeholder="Пароль"
          value={pwPass}
          onChange={(e) => setPwPass(e.target.value)}
        />
        <button
          disabled={!canPasswordLogin}
          onClick={async () => {
            if (!pwUser.trim() || !pwPass) return;
            setPwBusy(true);
            setPwMsg(null);
            try {
              const r = await window.api.loginPassword(pwUser, pwPass);
              setPwMsg(r.message);
              if (r.ok) {
                setPwPass('');
                setExAcc(await window.api.getExAccounts());
              }
            } catch (e) {
              setPwMsg(`Ошибка: ${errorText(e)}`);
            } finally {
              setPwBusy(false);
            }
          }}
        >
          {pwBusy ? 'Вхожу…' : 'Войти'}
        </button>
      </Row>
      {pwMsg && (
        <Row stack>
          <span className="set-note">{pwMsg}</span>
        </Row>
      )}

      <SubHead>Сохранённые аккаунты</SubHead>
      {exAcc.accounts.length === 0 ? (
        <Row stack>
          <span className="set-note">Нет ни одного аккаунта.</span>
        </Row>
      ) : (
        <Row stack>
          <div className="acct-list">
            {exAcc.accounts.map((a) => (
              <div className="acct-chip" key={a.id}>
                <button
                  className={`acct-name${a.id === exAcc.currentId ? ' active' : ''}`}
                  onClick={() => void window.api.setExAccount(a.id).then(setExAcc)}
                  title={a.id === exAcc.currentId ? 'Активный аккаунт' : 'Сделать активным'}
                >
                  {a.name}
                </button>
                <button
                  className="acct-del"
                  title="Удалить аккаунт"
                  aria-label="Удалить аккаунт"
                  onClick={async () => {
                    setExAcc(await window.api.removeExAccount(a.id));
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </Row>
      )}
      <Row label="Пул аккаунтов">
        <button
          onClick={() =>
            void (async () => {
              const r = await window.api.importExAccounts();
              if (r) {
                setExAcc(r.accounts);
                setExNotice(r.count > 0 ? `Импортировано аккаунтов: ${r.count}` : 'В файле не найдено аккаунтов');
              }
            })()
          }
        >
          Импортировать (Share, storage.json)
        </button>
      </Row>

      <SubHead>Новый аккаунт</SubHead>
      <Row label="Название" note="Необязательно.">
        <input aria-label="Название аккаунта" className="text-input" value={exName} onChange={(e) => setExName(e.target.value)} />
      </Row>
      <Row label="ipb_member_id">
        <input aria-label="ipb_member_id нового аккаунта" className="text-input" value={exMemberId} onChange={(e) => setExMemberId(e.target.value)} />
      </Row>
      <Row label="ipb_pass_hash">
        <input aria-label="ipb_pass_hash нового аккаунта" className="text-input" value={exPassHash} onChange={(e) => setExPassHash(e.target.value)} />
      </Row>
      <Row label="igneous" note="Только для ExHentai.">
        <input aria-label="igneous нового аккаунта" className="text-input" value={exIgneous} onChange={(e) => setExIgneous(e.target.value)} />
      </Row>
      <Row>
        <button
          className="set-primary"
          disabled={!canAddAccount}
          onClick={async () => {
            if (!exMemberId.trim() || !exPassHash.trim()) return;
            try {
              const r = await window.api.addExAccount(exName, exMemberId, exPassHash, exIgneous);
              setExAcc(r);
              setExNotice(`Добавлен аккаунт (${r.currentId ? r.accounts.find((a) => a.id === r.currentId)?.name : ''})`);
              setExName('');
              setExMemberId('');
              setExPassHash('');
              setExIgneous('');
            } catch (e) {
              setExNotice(`Ошибка добавления: ${errorText(e)}`);
            }
          }}
        >
          Добавить аккаунт
        </button>
      </Row>
      {exNotice && (
        <Row stack>
          <span className="set-note">{exNotice}</span>
        </Row>
      )}
    </Section>
  );
}
