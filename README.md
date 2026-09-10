# Notepad Code 📓

> Minimalist, monokrom (siyah-beyaz) tasarıma sahip; **VS Code**, **Cursor** ve **Google Antigravity** üzerinde sıfır yapılandırma ile çalışan, yapay zeka destekli evrensel not defteri eklentisi.

---

## ✨ Öne Çıkan Özellikler

- 🌐 **Tüm Çalışma Alanlarında Ortak (Universal Storage):** Hangi projede veya klasörde çalışırsanız çalışın, notlarınız `~/.notepad-code/notepad-code-data.json` üzerinde merkezi olarak saklanır ve her an erişilebilirdir.
- 🤖 **Yapay Zeka & MCP Desteği (Zero-Config Multi-IDE):**
  - **VS Code:** GitHub Copilot ile tam entegre 11 adet yerel dil aracı (Language Model Tools) ve `@notepad` Chat Katılımcısı.
  - **Cursor:** Cursor AI Composer için otomatik olarak yapılandırılan Model Context Protocol (MCP) sunucusu.
  - **Google Antigravity:** Global konfigürasyona otomatik işlenen MCP araçları ve hazır yetenek (Skill) entegrasyonu.
  - **Windsurf & Claude Desktop:** Algılandığında otomatik bağlanan MCP desteği.
- ⚡ **Canlı Dosya İzleyici (Real-Time Live Sync):** Cursor veya Antigravity gibi harici bir AI aracı not eklediğinde, sildiğinde veya güncellediğinde, VS Code arayüzü sayfayı yenilemeye gerek kalmadan **anında ve otomatik olarak** güncellenir.
- 🛡️ **Veri Kaybı Önleme (Native Safety Confirmation):** Not silme, defter silme veya içe aktarma gibi kritik eylemlerde kullanıcıdan açık onay alınmadan hiçbir işlem yürütülmez.
- ✍️ **Normal Düz Metin Formatı (Sıfır Markdown Kirliliği):** Yapay zeka modelleri sayfa oluştururken istemsizce `# Başlık`, `**kalın**`, ` ``` ` gibi Markdown etiketleri üretmez; akıllı normalizasyon motoru notları tertemiz, sade ve doğal metin formatında saklar.
- 🎨 **Minimalist Monokrom Tasarım:** Tamamen siyah (#000000) ve beyaz (#FFFFFF) tonlarıyla hazırlanmış, her tema ile kusursuz uyum sağlayan yüksek kontrastlı ve göz yormayan arayüz.
- 🧭 **Sidebar Title Butonları:** Kenar çubuğu başlık çubuğunda (`view/title`) yerleşik VS Code Codicon ikonları:
  - `$(new-folder)` Yeni Defter Oluştur
  - `$(export)` Notları Dışa Aktar (JSON)
  - `$(cloud-download)` Notları İçe Aktar (JSON)
- 📌 **Sabitleme & Canlı Arama:** Önemli notları en üste sabitleme ve tüm notlar arasında anlık metin araması.

---

## 🤖 Çoklu IDE & Yapay Zeka Entegrasyonu

Kullanıcının **hiçbir JSON dosyasını manuel düzenlemesine gerek yoktur**. Eklenti aktive edildiğinde sisteminizdeki IDE'leri algılar ve gerekli ayarları arka planda sessizce yapar.

```
                  ┌─────────────────────────────────────────┐
                  │   ~/.notepad-code/notepad-code-data.json│
                  │        (Merkezi Veri Havuzu)           │
                  └────────────────────┬────────────────────┘
                                       │
            ┌──────────────────────────┼──────────────────────────┐
            ▼                          ▼                          ▼
     ┌─────────────┐            ┌─────────────┐            ┌─────────────┐
     │   VS Code   │            │   Cursor    │            │ Antigravity │
     │  (Copilot)  │            │  (Composer) │            │  (AI Agent) │
     └─────────────┘            └─────────────┘            └─────────────┘
      Language Model              MCP Server                 MCP Server
       Tools & Chat             (mcp/server.js)            (mcp/server.js)
```

### 1. VS Code (GitHub Copilot)
- Copilot Chat panelinde `@notepad` yazarak doğrudan notlarınızla konuşabilirsiniz:
  - `@notepad /list` - Tüm defter ve sayfaları özetler.
  - `@notepad /search react` - Notlar içinde anlık arama yapar.
  - `@notepad "Python İpuçları" defterine "List Comprehension" sayfası ekle` - Doğal dille not oluşturur.
- GitHub Copilot, arka planda eklentinin sağladığı 11 adet yerel aracı (`notepad_list_notebooks`, `notepad_create_page`, vb.) otomatik olarak çağırabilir.

### 2. Cursor (AI Composer & Chat)
- Eklenti ilk kez çalıştığında `~/.cursor/mcp.json` ve çalışma alanındaki `.cursor/mcp.json` dosyalarını otomatik yapılandırır.
- Cursor AI Composer veya Chat panelinde doğrudan Notepad Code araçlarını kullanarak not alabilir, araştırma sonuçlarını defterlerinize kaydettirebilirsiniz.

### 3. Google Antigravity
- `~/.gemini/config/mcp_config.json` dosyasına otomatik eklenir.
- Projede hazır bulunan `.agents/skills/notepad-code/SKILL.md` sayesinde Antigravity asistanı tüm kuralları ve veri kaybı önleme mekanizmalarını bilerek hareket eder.

---

## 🛠️ Desteklenen Araçlar (11 Language Model / MCP Tools)

Tüm araçlar hem VS Code Copilot'a hem de standart MCP istemcilerine (Cursor, Antigravity) sunulmuştur:

| Araç Adı | Açıklama | Güvenlik / Onay |
| :--- | :--- | :--- |
| `notepad_list_notebooks` | Tüm defterleri, alt sayfaları ve ID'leri listeler. | Güvenli |
| `notepad_read_page` | Belirtilen notun tam metnini ve istatistiklerini okur. | Güvenli |
| `notepad_search_notes` | Defterler ve sayfalar arasında anahtar kelime araması yapar. | Güvenli |
| `notepad_create_notebook` | Yeni bir not defteri oluşturur (`title`, `description`). | Güvenli |
| `notepad_create_page` | Deftere temiz düz metin formatında yeni bir sayfa ekler. | Güvenli |
| `notepad_update_page` | Sayfanın başlığını veya içeriğini günceller. | Güvenli |
| `notepad_rename_notebook` | Not defterinin adını değiştirir. | Güvenli |
| `notepad_delete_page` | Belirtilen sayfayı kalıcı olarak siler. | ⚠️ **Kullanıcı Onayı Zorunlu** |
| `notepad_delete_notebook` | Defteri ve içindeki tüm sayfaları siler. | ⚠️ **Kullanıcı Onayı Zorunlu** |
| `notepad_export_notes` | Tüm veritabanını JSON yedek metni olarak dışa aktarır. | Güvenli |
| `notepad_import_notes` | JSON yedeğinden notları sisteme yükler / geri yükler. | ⚠️ **Kullanıcı Onayı Zorunlu** |

---

## 🛡️ Veri Kaybını Önleme Mekanizması

Yapay zeka modellerinin kaza eseri notları veya defterleri silmesini engellemek için çift katmanlı güvenlik uygulanmıştır:

1. **VS Code Copilot (Native Prepare Invocation):**
   - Model silme veya içe aktarma aracı çağırmak istediğinde VS Code yerel onay penceresi açar:
   - Kullanıcıya hangi defterin/sayfanın etkileneceği Markdown uyarısıyla sunulur. Kullanıcı **"Continue"** butonuna basmadan araç çalıştırılmaz.
2. **MCP Sunucusu (Explicit Confirmation Flag):**
   - `notepad_delete_page`, `notepad_delete_notebook` ve `notepad_import_notes` araçları `confirm: true` parametresi olmadan çağrıldığında işlemi reddeder ve modelden kullanıcıya açık onay sorusu yöneltmesini ister.

---

## 🏗️ Mimari & Proje Yapısı

Proje, hiçbir harici çalışma zamanı kütüphanesine bağımlı olmadan (Zero Runtime Dependencies), standart Node.js ve VS Code API'leri ile Clean Architecture prensiplerine uygun olarak geliştirilmiştir:

```
Notepad Code/
├── .agents/
│   ├── mcp_config.json             # Antigravity yerel MCP konfigürasyonu
│   └── skills/notepad-code/        # Antigravity yetenek tanımı (SKILL.md)
├── .cursor/
│   └── mcp.json                    # Cursor MCP bağlantı konfigürasyonu
├── mcp/
│   ├── server.js                   # Sıfır bağımlılıklı stdio JSON-RPC MCP sunucusu
│   └── auto-config.js              # Otomatik IDE MCP kayıt betiği
├── src/
│   ├── commands/                   # VS Code komutları (CommandRegistry)
│   ├── controllers/                # Webview denetleyicileri (Sidebar & Editor)
│   ├── copilot/                    # Copilot Language Model Tools & Chat Participant
│   ├── models/                     # Notebook ve Page domain sınıfları
│   ├── repositories/               # Disk kalıcılığı ve Real-Time File Watcher
│   ├── services/                   # İş mantığı ve McpAutoConfigService
│   └── extension.ts                # Eklenti yaşam döngüsü ve DI bootstrap
├── package.json                    # Araç tanımları ve menü katkıları
└── tsconfig.json
```

---

## 🚀 Geliştirme ve Derleme

### Gereksinimler
- Node.js (v18+)
- Visual Studio Code (v1.85+) veya Cursor

### Kurulum ve Derleme Komutları
```bash
# Bağımlılıkları yükleyin
npm install

# TypeScript tip denetimi
npm run typecheck

# Esbuild ile üretim paketi derleyin
npm run compile

# Değişiklikleri anlık izlemek için (Watch Mode)
npm run watch

# Kurulu IDE'leri otomatik olarak Notepad Code MCP sunucusuna bağlayın
npm run mcp:setup
```

### Hata Ayıklama (F5)
1. Projeyi VS Code veya Cursor içinde açın.
2. `F5` tuşuna basarak **Extension Development Host** penceresini başlatın.
3. Sol Activity Bar'daki **Notepad Code** ikonuna tıklayarak not defterinizi kullanmaya başlayın.

---

## ⌨️ Kısayollar ve Komut Paleti (Cmd+Shift+P / Ctrl+Shift+P)

- `Notepad Code: Open Full Editor` - Geniş ekran not düzenleyicisini yeni bir sekmede açar.
- `Notepad Code: New Notebook` - Hızlıca yeni bir defter oluşturur.
- `Notepad Code: New Page` - İstediğiniz deftere anında yeni sayfa ekler.
- `Notepad Code: Export Notes (JSON)` - Tüm notları JSON dosyası olarak kaydeder.
- `Notepad Code: Import Notes (JSON)` - JSON dosyasından notları geri yükler.

---

## 📄 Lisans

Bu proje MIT lisansı altında sunulmaktadır.
