# Panduan Doloyo

Doloyo (Your floppy little motion studio) adalah studio pose dan animasi 3D di browser. Pilih manekin atau bentuk dasar, atur sendi, susun keyframe, lalu ambil snapshot PNG. Semua berjalan di komputer kamu sendiri; proyek disimpan otomatis di browser.

## Mulai cepat

1. Klik sendi atau badan manekin di viewport untuk memilihnya (warna jadi biru).
2. Putar sendi dengan cincin gizmo, atau ketik derajat di panel Inspector.
3. Geser playhead di timeline ke waktu lain, ubah pose, tekan `K` untuk menyimpan keyframe.
4. Tekan `Space` untuk memutar animasi.

## Kamera

- Klik kanan lalu geser: orbit.
- Klik tengah lalu geser: pan.
- Scroll: zoom.
- `F`: pindahkan titik pandang ke objek terpilih (tanpa pilihan: kembali ke tengah scene).
- Klik area kosong untuk membatalkan pilihan.

## Objek (Outliner, kiri)

- Tombol `+` menambah Mannequin, Cube, Sphere, atau Cylinder. Tombol tempat sampah (atau `Delete`) menghapus objek terpilih.
- Klik nama untuk memilih. Panah di samping manekin membuka daftar 17 sendi; klik sendi untuk memilihnya.
- Nama objek bisa diubah di Inspector.

## Posing manekin (FK)

- Klik sendi atau potongan badan: sendi itu terpilih dan gizmo rotasi muncul.
- Putar cincin gizmo. Saat dilepas, nilainya dipotong sesuai batas sendi (misalnya lutut tidak bisa menekuk ke depan).
- `R` mode rotasi, `G` mode geser, `S` mode skala (untuk objek).
- Sendi `hips` bisa digeser dengan `G`, jadi manekin bisa jongkok atau melompat tanpa memindahkan seluruh objek.
- Tanpa sendi terpilih, gizmo menggerakkan seluruh objek.

## Inspector (kanan)

- **Rotation sendi**: tiga kolom X, Y, Z dalam derajat. Geser label (X/Y/Z) ke kiri atau kanan untuk scrub; tahan `Shift` untuk lebih halus, `Alt` untuk lebih cepat. Atau klik kolom dan ketik angka, lalu `Enter`.
- Kolom yang dikunci batas sendi tampak redup.
- **Reset joint** mengembalikan sendi terpilih ke netral. **Reset pose** mengembalikan seluruh tubuh.
- **Character**: model dan material (lihat bagian Karakter).
- **Preset**: stand, t_pose, crouch, kneel, point, wave_up.
- **Mirror L to R / R to L** menyalin pose sisi kiri ke kanan (atau sebaliknya). Pintasan `M` (kiri ke kanan) dan `Shift+M` (kanan ke kiri).
- **Transform**: posisi, rotasi, dan skala objek.

### Pose library

Di bagian Pose (khusus manekin): ketik nama di kolom **Pose name** lalu klik **Save pose** (atau `Enter`) untuk menyimpan pose saat ini. Pose tersimpan muncul di daftar: **Apply** menerapkannya, ikon tempat sampah menghapusnya. Pose disimpan di dalam file proyek (`customPoses`), jadi ikut tersimpan dan terekspor. Nama tidak boleh sama dengan preset bawaan. Menyimpan dengan nama yang sudah ada menimpa pose lama (bisa di-undo).

## Bentuk dasar

Cube, Sphere, dan Cylinder dianimasikan lewat posisi, rotasi, dan skala. Pakai `G`, `R`, `S` atau ketik di Inspector.

## Timeline (bawah)

- Tombol play/pause (`Space`), stop (kembali ke 0), waktu `mm:ss.cc`, lalu nomor frame.
- **fps**: 24, 30, atau 60. **Dur**: durasi dalam detik. **Loop**: ulang otomatis.
- Klik atau geser di penggaris (angka detik) untuk memindahkan playhead. `,` dan `.` mundur/maju satu frame.
- Setiap objek punya satu baris dengan berlian (diamond) untuk keyframe. Untuk manekin terpilih, panah di baris objek membuka baris per sendi (hanya sendi yang punya key, ditambah sendi terpilih).
- Klik berlian untuk memilih key (playhead ikut pindah ke key itu). Geser berlian untuk memindahkan key. `Delete` menghapus key terpilih.
- **Easing** (dropdown di toolbar) berlaku untuk segmen yang MULAI dari key terpilih: Linear, Ease in, Ease out, Ease in-out, Step (lompat), atau kurva bezier kustom (diedit di Curve editor, lihat bagian di bawah).
- Zoom/pan timeline, seleksi kotak, pindah banyak key, dan copy/paste key dijelaskan di bagian **Timeline (lanjutan)**.

## Keyframe

- `K` atau tombol **Set key**: menyimpan pose saat ini di posisi playhead. Untuk manekin: semua sendi, geseran hips, dan transform objek. Untuk bentuk dasar: posisi, rotasi, skala.
- **Auto-key**: kalau menyala, setiap perubahan pose atau transform otomatis ikut membuat key di playhead.
- Rotasi diantara dua key memakai interpolasi quaternion (slerp), jadi putaran mulus tanpa gimbal aneh.

### Penting: mengedit objek yang sudah beranimasi

Setiap kali playhead pindah (atau animasi berputar), pose objek dihitung dari keyframe-nya. Kalau kamu mengubah pose tanpa Auto-key dan tanpa menekan `K`, perubahan itu hanya tampil sementara (pose "tertunda") sampai playhead bergerak lagi, lalu kembali ke nilai keyframe.

Jadi untuk mengedit objek beranimasi: aktifkan **Auto-key**, atau ubah pose lalu tekan `K` di playhead yang sama.

## Onion skin

Tombol **Onion** di toolbar timeline (pintasan `O`) menampilkan bayangan transparan manekin terpilih: biru untuk key sebelumnya, oranye untuk key berikutnya. Dropdown di sebelahnya mengubah jarak: **Keys** (key terdekat sebelum/sesudah playhead) atau +-1, 2, 3, 5, 10 frame. Bayangan memakai karakter yang sama dengan manekinnya (salinan transparan; art doll memakai siluetnya sendiri), paling banyak 2 bayangan (sebelum dan sesudah). Bayangan tidak bisa diklik, tidak punya bayangan lantai, dan tidak ikut tergambar di snapshot atau export.

## IK dan pin kaki

**IK** (inverse kinematics) menarik ujung tangan atau kaki, lalu siku atau lutut ikut menekuk otomatis. Hasilnya tetap berupa rotasi sendi biasa (sama seperti `joint_set`), jadi semua karakter, keyframe, undo, dan export bekerja seperti biasa.

- Pilih manekin, lalu nyalakan **IK** di toolbar viewport (di samping Rotate/Move/Scale) atau tekan `I`. Berlian biru kecil muncul di dua pergelangan tangan dan dua pergelangan kaki.
- Klik sebuah berlian: gizmo geser muncul di sana. Seret gizmo, anggota badan mengikuti secara langsung. Saat dilepas, hasilnya disimpan sebagai **satu langkah undo** (perintah `ik_reach`).
- Kalau targetnya terlalu jauh, anggota badan lurus penuh menuju target. Batas sendi dihormati secara longgar (nilai yang melewati batas dipotong).
- Siku dan lutut mempertahankan sisi tekukan yang sekarang (lutut ke depan, siku ke belakang untuk pose lurus). Di Inspector, bagian **IK**, kolom **Pole angle** per anggota badan memutar siku/lutut mengitari garis bahu-ke-tangan (atau pinggul-ke-kaki) tanpa memindahkan tangan atau kaki.
- Tekan `I` dengan sendi terpilih untuk langsung memilih anggota badan itu.

### Pin kaki

Di Inspector > IK: centang **Pin left foot** / **Pin right foot**. Kaki yang di-pin tetap di posisi dunia-nya saat badan bergerak: geser hips dengan `G`, pindahkan seluruh objek, atau putar animasi dengan key pada hips. Kaki dihitung ulang dengan IK, jadi lutut menekuk sendiri. Pin juga berlaku saat export.

- Sendi kaki yang di-pin tidak bisa diubah dengan tangan (nilainya dihitung ulang). Lepas centang pin untuk mengeditnya.
- Menarik kaki yang di-pin dengan handle IK memindahkan pin-nya.
- **Bake pins** mengubah hasil menjadi key biasa: kaki di-key pada setiap frame (dari key pertama sampai terakhir), lalu pin dilepas. Hasilnya tetap sama tanpa pin. Satu langkah undo.

## Curve editor

Di toolbar timeline, tombol **Keys | Curves** mengganti tampilan. **Curves** menampilkan grafik nilai terhadap waktu untuk channel objek terpilih (rotasi sendi terpilih, posisi hips, transform objek, atau channel kamera). Warna: X merah, Y hijau, Z biru (redup, bukan neon). Daftar kiri menyalakan atau mematikan channel.

- **Titik key**: klik untuk memilih (shift untuk menambah). Seret ke atas/bawah untuk mengubah **nilai**, ke kiri/kanan untuk mengubah **waktu** (menempel ke frame). Shift saat menyeret mengunci ke satu arah. Banyak key terpilih bergerak bersama. Satu seretan = satu langkah undo.
- **Box select**: seret di area kosong. **Zoom**: scroll (waktu), `Shift`+scroll (nilai). **Pan**: seret dengan klik tengah. `F` saat mouse di grafik: **frame all** (muat semua key).
- Klik di baris angka di atas grafik untuk memindahkan playhead.
- **Easing bezier**: pilih satu key. Dua kotak kecil (tangent handle) muncul untuk segmen yang KELUAR dari key itu (menuju key berikutnya). Seret untuk membentuk kurva `cubic-bezier(x1, y1, x2, y2)` seperti CSS (y di luar 0..1 memberi efek overshoot). Tombol **Linear / In / Out / In-out / Step** di atas grafik mengembalikan easing bawaan. Easing bawaan (linear, ease in, ease out, ease in-out) setara dengan preset bezier; kalau kurvanya diedit, tersimpan sebagai `{type:"bezier", c:[x1,y1,x2,y2]}`. Untuk channel rotasi, kurva easing mengatur parameter slerp.

## Timeline (lanjutan)

- **Zoom/pan**: `Ctrl`+scroll (atau scroll di penggaris) zoom di sekitar kursor; `Shift`+scroll atau klik tengah+seret menggeser; slider zoom dan tombol **Fit** di toolbar.
- **Seleksi kotak (marquee)**: seret di area kosong baris key untuk memilih banyak key. `Shift`/`Ctrl`+klik menambah atau mengurangi.
- **Pindah banyak key**: seret salah satu key terpilih; semuanya bergeser sama jauh (satu langkah undo). `Delete` menghapus semua key terpilih.
- **Copy/paste**: `Ctrl+C` menyalin key terpilih, `Ctrl+V` menempel di posisi playhead pada objek terpilih (boleh objek lain dengan jenis yang sama, misalnya manekin ke manekin). Jarak antar key dan easing ikut tersalin. Satu langkah undo.

## Kamera render

Kamera render adalah objek terpisah yang bisa dianimasikan dengan key (channel `position`, `target`, `fov`).

1. Outliner > **+** > **Render Camera**. Kamera dibuat di posisi pandang editor sekarang. Hanya ada satu kamera render.
2. Gizmo di viewport: kerucut pandang (frustum) abu-abu, silang kecil di titik tuju. Geser kamera dengan `G`; **Target** dan **FOV** diatur di Inspector.
3. **Set from view** di Inspector menyalin pandangan orbit editor ke kamera (opsional sekaligus membuat key). **Look through** (`C`, atau tombol **Cam** di toolbar viewport) melihat lewat kamera; bingkai aman (safe frame) tampil dengan rasio resolusi export, garis putus-putus adalah area aman 90%. Tekan `C` lagi untuk kembali ke pandangan editor.
4. Animasikan: pindahkan playhead, ubah kamera (Set from view / Inspector / gizmo), tekan `K` (atau Auto-key). Easing key berlaku juga untuk kamera.
5. Export memakai kamera render (dengan nilai animasi per frame) bila ada; kalau tidak, memakai pandangan editor. Aspek mengikuti resolusi export.

Snapshot cepat (tombol Snapshot) tetap memakai pandangan editor.

## Gambar referensi

Pasang gambar referensi seperti di Blender, dengan tiga cara. Semuanya lokal: gambar disimpan di browser ini (IndexedDB, seperti karakter hasil import), tidak diunggah ke mana pun.

- **Viewport background**: gambar di belakang scene, menempel ke layar. Pilih `Fit` (seluruh gambar terlihat), `Fill` (menutup bingkai, bisa terpotong) atau `Center` (ukuran piksel asli), lalu atur `Opac` (opasitas) dan `Visible`.
- **Image plane**: bidang bergambar di dalam scene 3D dengan rasio asli gambar. Digeser, diputar, dan diskalakan dengan gizmo seperti bentuk dasar, dan bisa dikeyframe (`K`). Opsi: opasitas, `Double sided`, `Locked` (tidak bisa dipilih di viewport, tetap ada di Outliner), `Always face camera` (selalu menghadap kamera, rotasi diabaikan).
- **Camera background**: gambar terkunci pada bingkai kamera render. Terlihat saat melihat lewat kamera (`C`) dan ikut di-render. Perlu kamera render (Outliner > **+** > **Render Camera**).

**Menambah gambar:** menu **File > Add reference image...**, Outliner **+** > **Reference image...**, atau seret file gambar ke viewport. Sebuah popover kecil menanyakan mau dipakai sebagai apa. Format: PNG, JPG, WebP (wajib), GIF (frame pertama), SVG; maksimal 20 MB. Background muncul di Outliner pada bagian **Reference images**; klik barisnya untuk mengatur di Inspector (tombol **Remove** menghapusnya). Semua langkah bisa di-undo.

**Include in render:** kalau dicentang (default), gambar ikut di Snapshot, export PNG/PNG sequence/WebM/MP4, dan GLB (image plane menjadi quad bertekstur). Matikan kalau gambar hanya panduan untuk kamu.

**Menyimpan:** file `.mdoll.json` hanya menyimpan id gambar. Kalau gambar tidak ada di browser yang membuka proyek, muncul peringatan dan gambarnya tidak tampil. Saat **Save**, centang **Embed images in the project file** untuk menyisipkan gambar sampai 2 MB ke dalam file supaya bisa dibuka di browser lain; gambar yang lebih besar tetap hanya direferensikan.

**Lewat agent:** tool `image_add` (file lokal lewat `path`), `image_set` dan `image_remove`; lihat `docs/AGENT.md`.

## Export GLB dan BVH

Di dialog **Export**:

- **GLB animation**: animasi `.glb` untuk Blender, Unity, atau Unreal, di-bake pada fps pilihanmu (default fps proyek). Pilih semua objek atau **Selected object only**. Karakter skinned (Mannequin, Superhero, import) diekspor sebagai skinned mesh dengan animasi tulang; art doll prosedural diekspor sebagai hirarki node sendi dengan mesh (animasi node, bekerja di Blender). Kamera render ikut sebagai node kamera dengan animasi posisi dan arah; FOV disimpan pada frame pertama karena glTF tidak bisa menganimasikan FOV. Pin kaki sudah ikut diperhitungkan.
- **BVH**: gerakan 17 sendi satu manekin (terpilih, atau yang pertama) dalam sentimeter, Y ke atas.

## Preset scene

Di Outliner, ikon orang banyak membuka **Scene presets**: **Duo** (2), **Trio** (3), **Group of 5**, dan **Family** (ayah, anak, bayi yang duduk, ibu). Boneka baru berjajar dalam busur menghadap penonton (ujung sedikit maju dan menoleh ke tengah), seperti formasi dance crew. Secara default isinya campuran cewek dan cowok (bergantian Mannequin F dan M); pilih **Character** kalau mau satu model untuk semua, dan centang **Replace existing mannequins** kalau mau mengganti isi scene. Satu langkah undo. Agent: perintah `scene_preset`.

## Ukuran tubuh

Setiap manekin punya ukuran tubuh. Di Inspector, bagian **Body**:

- **Bayi / Kecil / Anak / Remaja / Dewasa**: pilih ukuran. Bayi (kecil) kira-kira 12 bulan, 0,75 m, kepala besar, leher pendek, tangan dan kaki pendek. Anak kira-kira 6-7 tahun, 1,20 m. Remaja 1,62 m (cewek 1,58 m). Dewasa 1,75 m (cewek 1,65 m) adalah tampilan asli.
- **Height**: slider ±10% dari tinggi preset; angkanya (meter) tampil di sebelahnya. Geser slider untuk menyetel, satu geseran = satu langkah undo. **Reset height** mengembalikan ke 1,0.
- **M / F**: cowok atau cewek. Perbedaannya halus saja (bahu sedikit lebih sempit), tidak pernah bentuk dada atau pinggul. Dewasa cewek memakai Mannequin F; ukuran lain memakai manekin netral (Mannequin M) untuk kedua gender, supaya anak dan remaja tampil sebagai manekin seni yang netral.
- Karakter Superhero hanya punya Teen dan Adult; tombol Baby dan Child dinonaktifkan.

Di menu **+** Outliner ada tambah cepat untuk 8 varian: Baby boy, Baby girl, Boy (child), Girl (child), Teen boy, Teen girl, Man, Woman (label UI dalam bahasa Inggris).

Semua ikut ukuran tubuh: IK, pin kaki, Copy Dance (kunci kaki), onion skin, volume klik, export GLB dan BVH. Kaki selalu menapak lantai. Pose dan keyframe hanyalah rotasi, jadi animasi library dan mocap bisa dipakai di ukuran mana pun. Geseran **hips** (offset hips) disimpan dalam satuan dewasa dan otomatis diskalakan ke tinggi tubuh, jadi lompat atau jongkok tetap menapak. Mengubah ukuran tubuh melepas pin kaki (undo mengembalikannya).

Pose untuk bayi (di Pose > Preset, bisa dipakai di ukuran apa pun): **duduk** (duduk di lantai, kaki ke depan), **merangkak** (tangan dan lutut di lantai), **berdiri_pegangan** (berdiri, kedua tangan terangkat seperti berpegangan). Tinggi hips disetel otomatis dari tubuhnya supaya kaki, lutut, dan tangan menyentuh lantai; dirancang untuk Bayi (di tubuh lebih besar, tangan saat merangkak bisa melayang). Agent: `object_set_body`, atau `body` pada `object_add` dan `scene_preset`.

## Undo / redo

- `Ctrl+Z` undo, `Ctrl+Shift+Z` atau `Ctrl+Y` redo.
- Scrub angka berturut-turut digabung jadi satu langkah undo. Perpindahan playhead tidak masuk riwayat undo.

## Snapshot PNG

Tombol **Snapshot** di bar atas: pilih ukuran (720p, 1080p, 4K) dan opsi latar transparan, lalu Download PNG. Grid dan gizmo tidak ikut tergambar. Rasio gambar selalu 16:9, jadi framing bisa sedikit berbeda dari viewport.

## Export

Tombol **Export** di bar atas (atau **File > Export...**) membuka dialog export. Semua diproses di browser kamu; tidak ada yang diunggah.

- **Format**: PNG (frame di playhead), PNG sequence (`.zip` berisi satu PNG per frame), WebM, MP4 (H.264), GLB animation, BVH, atau file proyek. Gambar dan video memakai **kamera render** bila ada (lihat bagian Kamera render).
- **Resolusi**: 720p, 1080p, 4K, atau Custom (16 sampai 7680 piksel). Video otomatis dibulatkan ke angka genap.
- **Frame rate**: default sama dengan fps proyek. **Range**: seluruh durasi (animasi yang tidak loop ikut menyertakan frame terakhir).
- **Transparent background**: hanya untuk PNG dan PNG sequence.
- Progress bar dan tombol **Cancel** tampil selama render. Render dilakukan frame demi frame (t = nomor frame / fps) sehingga hasilnya selalu sama. Grid, gizmo, dan onion skin disembunyikan.
- WebM dan MP4 memakai WebCodecs (Chrome atau Edge terbaru). Kalau browser tidak mendukung, muncul pesan dan kamu bisa memakai PNG sequence, lalu menyusunnya dengan ffmpeg.

## Karakter

Semua karakter memakai **data pose yang sama** (17 sendi + posisi hips + keyframe). Karakter hanyalah tampilan (view) dari pose itu, jadi undo, keyframe, export, onion skin, dan agent bekerja sama untuk semuanya.

Pilih di Inspector, bagian **Character**:

- **Art doll (procedural)**: boneka seni buatan sendiri (torso melengkung, anggota badan meruncing, sendi bola, kepala telur, tangan mitten), abu matte `#CFCFD2`.
- **Mannequin F** dan **Mannequin M** (Quaternius, CC0): manekin mulus ber-skeleton. Mannequin F adalah **default** untuk manekin baru.
- **Superhero M** dan **Superhero F** (Quaternius, CC0): karakter bertekstur.
- Karakter hasil import (lihat di bawah) muncul dengan label "(imported)".

**Material**: `Doll` = abu matte (biru lembut saat terpilih), `Original` = tekstur asli file. Superhero memakai Original secara default.

Klik badan karakter tetap memilih sendi terdekat (ada volume klik tak terlihat di posisi sendi), jadi gizmo rotasi bekerja seperti biasa. Sendi terpilih ditandai bola biru kecil.

Superhero M dan F punya satu gaya rambut masing-masing (Quaternius, CC0, terikat ke tulang kepala). Rambut hanya tampil pada material **Original**.

## Import karakter

**File > Import character...** menerima `.glb`, `.gltf`, dan `.vrm`.

- VRM: tulang dipetakan otomatis dari humanoid VRM.
- GLB/glTF: tulang dicocokkan lewat nama (Unreal/Quaternius, Mixamo `mixamorig:*`, atau `Hips/Spine/LeftArm...`). Kalau ada sendi yang belum terpetakan, atau kamu mau memeriksa, buka **Edit bone mapping** dan pilih tulang untuk tiap sendi. Sendi tanpa tulang tetap di pose diam.
- File harus punya mesh dengan skeleton (skinned).
- Setelah import, karakter langsung dipakai oleh manekin yang terpilih.

**Penting:** file karakter hasil import disimpan **hanya di browser ini** (IndexedDB). File proyek `.mdoll.json` cuma menyimpan id-nya dan tidak membawa model. Di komputer lain, import file yang sama lagi lalu pilih di Inspector. Kalau karakter tidak ditemukan, app menampilkan art doll dan memberi pemberitahuan.

## Library Animasi

Tab **Animations** di panel kiri (sebelah Outliner) berisi 86 klip gerakan gratis (Quaternius, CC0): jalan, lari, idle, duduk, pedang, pistol, loncat, dance, dan lain-lain. Daftar dimuat dari file kecil; file animasinya baru diunduh saat kamu memakainya.

- **Search** untuk mencari nama klip.
- **Hover** (arahkan mouse sebentar) atau **klik** sebuah klip untuk preview di viewport pada manekin terpilih, tanpa mengubah proyek. Klik lagi untuk berhenti.
- **Apply** menaruh klip sebagai keyframe. Hasilnya **satu langkah undo**.
- **Apply options**: target (manekin terpilih atau semua manekin), mulai dari playhead, speed, jumlah loop, kerapatan key (tiap 1/2/3/5 frame; 2-5 membuat track lebih ringan dan mudah diedit), mirror kiri/kanan, in place (buang perpindahan horizontal hips), dan perpanjang timeline bila klip lebih panjang.
- Klip diambil dari skeleton Quaternius lalu dikonversi ke 17 sendi kita, jadi bisa dipakai oleh karakter apa pun. Nilai sendi dibatasi longgar (bukan batas manusia yang ketat) supaya gerakan tidak rusak.

## Copy Dance (gerakan dari video)

**Copy Dance** (tombol di top bar, atau File > Copy Dance) membaca gerakan orang di sebuah video dan mengubahnya jadi keyframe. Semua berjalan **lokal di browser** (MediaPipe Pose Landmarker, Apache-2.0); video tidak pernah diunggah.

Setup sekali: `npm run fetch-models` (menyalin WASM dan mengunduh model `pose_landmarker_full.task` ke `public/mediapipe`). Tanpa file lokal itu (misalnya situs yang di-deploy tanpa model), app memuat runtime WASM (jsDelivr) dan model (Google storage) dengan versi terpasang, dan dialog menampilkan catatan "Model loaded from CDN". Hanya file model yang diunduh; video tetap di komputer kamu.

Langkah:

1. **Choose video...** (mp4 atau webm). Preview video tampil dengan overlay skeleton berwarna per orang setelah analisis.
2. Atur: **People (max)** 1-4, **Sample fps**, **Smoothing** (filter One-Euro: *cutoff* kecil = lebih halus, *speed response* besar = lebih cepat mengikuti gerakan cepat), **Foot lock** (kaki terendah menempel lantai), **In place**, **Mirror** (video selfie), kerapatan key, **Start at playhead**.
3. **Analyze**. Ada progress dan Cancel. GPU dipakai dulu, otomatis jatuh ke CPU kalau gagal.
4. Setiap orang yang terdeteksi muncul sebagai chip berwarna. Pilih doll tujuan untuk tiap orang: manekin yang ada, **Create new doll**, atau Skip.
5. **Apply as keys**: satu langkah undo.

Pola pemakaian: 1 video ke 1 doll; 1 video berisi beberapa penari ke beberapa doll; atau tiap doll punya video sendiri (jalankan dialog lagi untuk doll berikutnya, dan pakai **Start at playhead** untuk menempelkan di posisi tertentu).

Tips supaya hasilnya bagus:

- **Kamera diam** (pakai tripod atau sandarkan).
- **Seluruh badan terlihat** dari kepala sampai kaki, jangan terpotong.
- **Pencahayaan terang** dan merata.
- **Baju kontras** dengan latar (jangan baju hitam di latar hitam).
- Hadap kamera lebih baik daripada menyamping; hindari gerakan yang menutupi badan (tangan menyilang di depan).
- Satu orang per frame lebih akurat. Orang yang saling melintas bisa tertukar; periksa overlay.
- Akurasinya setara mocap webcam: gerakan sangat cepat dan oklusi menurunkan kualitas, jadi rapikan sedikit di timeline. Naikkan Smoothing kalau bergetar.

Catatan: arah hadap mengikuti kamera. Kalau video diambil dari samping, doll akan tampak berputar mengikuti sudut itu.

## Bantuan, tur, dan contoh

Menu **Help** berisi:

- **Guide** (`?`): panduan ini.
- **Tour**: tur 5 langkah (viewport, Inspector, timeline dan key, Animations dan Copy Dance, Export dan Agent). Muncul otomatis saat pertama kali membuka app; bisa dilewati dengan **Skip** atau `Esc`, dan dibuka lagi kapan saja dari sini. Panah kiri dan kanan berpindah langkah. Di layar sempit, panel yang tersembunyi diganti kartu di tengah layar.
- **Example: Wave hello / Dance crew / Sword duel**: proyek contoh siap pakai (satu boneka melambai, grup 5 menari dengan kamera render bergerak, dua boneka berduel pedang). Memuat contoh menggantikan proyek yang sedang terbuka, jadi simpan dulu kalau perlu.
- **Keyboard shortcuts**: tabel pintasan.
- **About**: versi dan lisensi.

## Layar sempit

Di bawah lebar 900 px, panel kiri (Outliner/Animations) dan kanan (Inspector) menjadi overlay yang dibuka dengan tombol di pojok top bar, supaya viewport tetap lega. Popover (Agent, menu, snapshot) selalu tetap di dalam layar.

## Menyimpan proyek

- Autosave: proyek disimpan otomatis ke IndexedDB browser dan dimuat lagi saat app dibuka.
- Menu **File**: New, Open `.mdoll.json`, Save `.mdoll.json` (`Ctrl+S`; kalau proyek memakai gambar referensi muncul pilihan untuk menyisipkannya), Import character, Add reference image, Copy Dance, Snapshot, Export.
- Ekstensi tetap `.mdoll.json` (nama lama Doloyo adalah Motion Doll Studio); file lama tetap bisa dibuka, dan proyek, karakter, serta pengaturan yang tersimpan di browser dipindahkan otomatis saat pertama kali memuat versi baru.
- File `.mdoll.json` adalah JSON biasa yang bisa dibaca manusia dan agent.

## Pintasan

| Tombol | Aksi |
| --- | --- |
| `Space` | play / pause |
| `K` | set keyframe di playhead |
| `R` / `G` / `S` | mode rotasi / geser / skala |
| `I` | IK on/off (handle di pergelangan tangan dan kaki; dengan sendi terpilih, langsung memilih anggota badan itu) |
| `C` | lihat lewat kamera render on/off |
| `M` / `Shift+M` | mirror pose kiri ke kanan / kanan ke kiri |
| `Ctrl+Z`, `Ctrl+Shift+Z`, `Ctrl+Y` | undo, redo |
| `,` dan `.` | frame sebelumnya dan berikutnya |
| `F` | fokus kamera ke objek terpilih; di grafik Curves: frame all |
| `Delete` | hapus key terpilih (semua key terpilih), atau objek bila tidak ada key/sendi terpilih |
| `Ctrl+C` / `Ctrl+V` | copy key terpilih / paste di playhead pada objek terpilih |
| `O` | onion skin on/off |
| `Ctrl`+scroll di timeline | zoom timeline (di Curves: scroll = zoom waktu, `Shift`+scroll = zoom nilai) |
| klik tengah + seret | pan timeline / grafik / viewport |
| `Esc` | batalkan pilihan, tutup guide |
| `?` | buka atau tutup guide |
| `Ctrl+S` | simpan file proyek |

Pintasan dimatikan saat kamu mengetik di kolom angka atau teks.


## Agent (kontrol lewat MCP lokal)

Pil **Agent** di pojok kanan atas membuka panel koneksi. Titik hijau berarti terhubung. Semuanya lokal: agent bicara ke server MCP di komputer kamu, server itu bicara ke tab ini lewat WebSocket `127.0.0.1:7777`.

1. Sekali saja, di folder proyek: `npm run mcp:install` lalu `npm run mcp:build`.
2. Daftarkan ke agent, misalnya Claude Code: `claude mcp add doloyo -- node <path>/mcp/dist/index.js` (detail di `mcp/README.md`).
3. Server menampilkan **pairing code** 6 digit (di log stderr, di file `doloyo-pairing.txt` di folder temp, atau minta agent memanggil `bridge_status`).
4. Di panel Agent, masukkan kode lalu klik **Connect**. Kalau koneksi putus, app mencoba menyambung lagi otomatis sampai 3 kali; setelah itu berhenti (supaya konsol browser tidak penuh pesan error) dan tombol **Bridge offline - Retry** muncul di panel. Tombol **Connect** tetap bisa dipakai manual.

**Izin** (dropdown Permissions): Read-only (agent hanya melihat scene dan snapshot), Edit (boleh mengubah, undo, redo), Edit + Render (boleh juga membuat file render). Edit dari agent masuk ke riwayat undo yang sama, jadi `Ctrl+Z` membatalkannya. **Activity** menampilkan 100 panggilan agent terakhir (jam, metode, ringkasan, ok/error).

**Memakai app dari situs (https):** alamat bridge tetap `ws://127.0.0.1:7777`. Chrome dan Edge bisa menampilkan prompt *Private Network Access*: izinkan. Safari memblokir koneksi ini; pakai instalasi lokal (`npm start`). Jalankan server dengan origin situs itu: `node <path>/mcp/dist/index.js --allow-hosted` (untuk situs lain: `--origin https://alamat.situs`).

Tanpa agent, semua aksi tetap bisa dicoba dari konsol browser: `window.doloyo.help()` menampilkan daftar perintah.
