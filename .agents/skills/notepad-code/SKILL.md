---
name: notepad-code
description: Notepad Code not defterlerini ve sayfalarını yönetmek, aramak, okumak, eklemek ve silmek için kullanılır.
---

# Notepad Code Skill

Bu skill, kullanıcının Notepad Code eklentisindeki not defterlerini (Notebooks) ve not sayfalarını (Pages) yönetmenizi sağlar.

## Kullanılabilir MCP Araçları

1. `notepad_list_notebooks`: Tüm defter ve sayfa başlıklarını listeler.
2. `notepad_read_page`: Belirtilen sayfanın tam içeriğini okur (`notebookId`, `pageId`).
3. `notepad_search_notes`: Notlar arasında metin araması yapar (`query`).
4. `notepad_create_notebook`: Yeni defter oluşturur (`title`, `description`).
5. `notepad_create_page`: Deftere yeni sayfa ekler (`notebookId`, `title`, `content`).
6. `notepad_update_page`: Sayfa başlığını veya içeriğini günceller (`notebookId`, `pageId`, `title`, `content`).
7. `notepad_rename_notebook`: Defter adını değiştirir (`notebookId`, `title`).
8. `notepad_delete_page`: Sayfayı kalıcı olarak siler (`notebookId`, `pageId`, `confirm: true`).
9. `notepad_delete_notebook`: Defteri ve altındaki tüm sayfaları kalıcı olarak siler (`notebookId`, `confirm: true`).
10. `notepad_export_notes`: Tüm notları JSON yedeği olarak alır.
11. `notepad_import_notes`: JSON yedeğini yükler (`jsonData`, `confirm: true`).

## ⚠️ Güvenlik ve Veri Kaybını Önleme Kuralı

`notepad_delete_page`, `notepad_delete_notebook` ve `notepad_import_notes` araçları kalıcı veri kaybı riski taşır.
- Bu araçları çağırmadan önce kullanıcıdan açık onay almadan `confirm: true` parametresi ASLA gönderilmemelidir.
- Kullanıcıya tam olarak hangi defter veya sayfanın silineceği açıkça belirtilmeli, onay alındıktan sonra işlem tamamlanmalıdır.

## 📝 Format Kuralı (Normal / Düz Metin Formatı)

Notepad Code'da tüm notlar **normal düz metin (plain text)** formatında tutulur.
- Sayfa içeriği oluştururken veya güncellerken Markdown sözdizimi (`#`, `##`, `**kalın**`, ` ``` ` vb.) **KULLANMAYIN**.
- Başlıkları veya maddeleri düz, doğal ve okunabilir metin satırları olarak yazın. 
