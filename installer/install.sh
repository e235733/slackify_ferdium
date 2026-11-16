#!/bin/bash
# ferdium-gchat-slackify installer / manager (template: payloads are embedded by package-installer.mjs).
#
#   install.sh [--install]    install or update (default)
#   install.sh --status       show what is installed and whether files were modified
#   install.sh --dry-run      validate and show the plan; writes nothing (combine with --rollback/--uninstall)
#   install.sh --rollback     undo the last install/update
#   install.sh --uninstall    remove everything this tool manages and restore the original files
#
# Only the Ferdium "hangoutschat" recipe directory is touched. Nothing is downloaded or executed
# from the network; macOS built-in tools only (plutil, shasum, base64, gunzip, awk, ...).
#
# Bash 3.2 compatible (macOS /bin/bash).

set -euo pipefail
umask 077

readonly FS_VERSION='@@VERSION@@'
readonly PAYLOAD_ID='@@PAYLOAD_ID@@'
readonly SHA_CSS='@@SHA_CSS@@'
readonly SHA_RT='@@SHA_RT@@'
readonly SHA_JS='@@SHA_JS@@'
PAYLOAD_CSS_B64='@@B64_CSS@@'
PAYLOAD_RT_B64='@@B64_RT@@'
PAYLOAD_JS_B64='@@B64_JS@@'

readonly CSS_BEGIN='/* BEGIN FERDIUM-SLACKIFY MANAGED */'
readonly CSS_END='/* END FERDIUM-SLACKIFY MANAGED */'
readonly JS_MARKER='FERDIUM-SLACKIFY-MANAGED'
# Ferdium ships two Google Chat recipes; the folder name equals the recipe id (ServerApi.getInstalledRecipes):
#   hangoutschat  https://chat.google.com          (name "Hangouts Chat")
#   hangouts      https://mail.google.com/chat/    (name "Google Chat")
# Only these exact (id, serviceURL) pairs are accepted; if both are installed the installer stops.
recipe_id_known() { case "$1" in hangoutschat|hangouts) return 0 ;; esac; return 1; }
recipe_pair_ok() { case "$1|$2" in 'hangoutschat|https://chat.google.com'|'hangouts|https://mail.google.com/chat/') return 0 ;; esac; return 1; }
readonly KEYS='rt orig css js'   # placement order: user.js (the entry point) goes last on install

FERDIUM_DIR="${HOME}/Library/Application Support/Ferdium"
MANAGE_DIR="${HOME}/Library/Application Support/Ferdium-Slackify"
RECIPE=''
TMPD=''
LOCK_HELD=0
TXN=0
CUR_BACKUP=''
LEDGER_TOUCHED=0
DRY=0
CMD='install'

# ---------------------------------------------------------------- output
say()  { printf '%s\n' "$*"; }
info() { printf '[fs-slackify] %s\n' "$*"; }
warn() { printf '[fs-slackify] WARN: %s\n' "$*" >&2; }
die()  { local code="$1"; shift; printf 'ERROR[%s]: %s\n' "$code" "$*" >&2; exit 1; }

# ---------------------------------------------------------------- small helpers
fname() {
  case "$1" in
    css) printf 'user.css' ;;
    js) printf 'user.js' ;;
    rt) printf '.fs-runtime.cjs' ;;
    orig) printf '.fs-original-user.cjs' ;;
  esac
}
sha_of() { if [ -f "$1" ]; then shasum -a 256 -- "$1" | awk '{print $1}'; else printf -- '-'; fi; }
mode_of() { stat -f %Lp -- "$1"; }
now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }
is_link() { [ -L "$1" ]; }

b64_flag=''
probe_b64() {
  if [ "$(printf 'QQ==' | base64 -D 2>/dev/null || true)" = 'A' ]; then b64_flag='-D'
  elif [ "$(printf 'QQ==' | base64 -d 2>/dev/null || true)" = 'A' ]; then b64_flag='-d'
  else die E_TOOLS 'base64 のデコードができません (base64 -D / -d)'; fi
}

check_tools() {
  local t
  [ "$(uname -s)" = 'Darwin' ] || die E_OS 'macOS 専用です (uname が Darwin ではありません)'
  for t in plutil shasum mktemp cp mv rm mkdir chmod stat date awk sed grep cat tail base64 gunzip od kill; do
    command -v "$t" >/dev/null 2>&1 || die E_TOOLS "必要なコマンドがありません: $t"
  done
  probe_b64
}

cleanup_tmp() {
  if [ -n "$TMPD" ] && [ -d "$TMPD" ]; then
    case "$TMPD" in
      */fs-slackify.*) rm -rf -- "$TMPD" ;;
    esac
  fi
  TMPD=''
}

# ---------------------------------------------------------------- manifest / ledger (key=value files)
# kv_load <file> <prefix>: sets variables <prefix><key> for every key=value line (keys validated).
kv_load() {
  local file="$1" prefix="$2" k v
  [ -f "$file" ] || return 1
  while IFS='=' read -r k v || [ -n "$k" ]; do
    case "$k" in ''|'#'*) continue ;; esac
    case "$k" in *[!a-z0-9_]*) die E_STATE "状態ファイルが壊れています: $file" ;; esac
    printf -v "${prefix}${k}" '%s' "$v"
  done < "$file"
}
kv_get() { local n="$1"; printf '%s' "${!n-}"; }

ledger_path() { printf '%s/state/ledger' "$MANAGE_DIR"; }
have_ledger() { [ -f "$(ledger_path)" ]; }
load_ledger() { L_recipe_dir=''; L_last_backup=''; L_baseline=''; L_post_css='-'; L_post_js='-'; L_post_rt='-'; L_post_orig='-'; L_payload_id=''; L_installed_at=''; kv_load "$(ledger_path)" L_; }

# ---------------------------------------------------------------- lock
acquire_lock() {
  local lock="$MANAGE_DIR/lock" pid
  mkdir -p -- "$MANAGE_DIR"; chmod 700 "$MANAGE_DIR"
  if ! mkdir -- "$lock" 2>/dev/null; then
    pid="$(cat "$lock/pid" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      die E_LOCK "別のインストーラーが実行中です (pid $pid)。終了してから再実行してください"
    fi
    warn "古いロックを削除します (pid ${pid:-不明} は存在しません)"
    rm -f -- "$lock/pid"; rmdir -- "$lock" 2>/dev/null || die E_LOCK "ロックを解除できません: $lock"
    mkdir -- "$lock" 2>/dev/null || die E_LOCK 'ロックを取得できません'
  fi
  printf '%s\n' "$$" > "$lock/pid"
  LOCK_HELD=1
}
setup_traps() { trap on_exit EXIT; trap on_signal INT TERM HUP; }
release_lock() {
  if [ "$LOCK_HELD" = 1 ]; then
    rm -f -- "$MANAGE_DIR/lock/pid"; rmdir -- "$MANAGE_DIR/lock" 2>/dev/null || true
    LOCK_HELD=0
  fi
}

# ---------------------------------------------------------------- recipe discovery & validation
discover_recipe() {
  local recipes="$FERDIUM_DIR/recipes" d id url count=0 skipped=''
  [ -d "$FERDIUM_DIR" ] || die E_NO_FERDIUM "Ferdium のプロファイルが見つかりません: $FERDIUM_DIR"
  is_link "$FERDIUM_DIR" && die E_SYMLINK "シンボリックリンクは対象外です: $FERDIUM_DIR"
  [ -d "$recipes" ] || die E_NO_RECIPE "recipes フォルダがありません: $recipes"
  is_link "$recipes" && die E_SYMLINK "シンボリックリンクは対象外です: $recipes"
  CANDIDATES=''
  for d in "$recipes"/*/; do
    d="${d%/}"
    [ -f "$d/package.json" ] || continue
    if ! id="$(plutil -extract id raw -o - -- "$d/package.json" 2>/dev/null)"; then skipped="$skipped $d"; continue; fi
    recipe_id_known "$id" || continue
    url="$(plutil -extract config.serviceURL raw -o - -- "$d/package.json" 2>/dev/null || true)"
    recipe_pair_ok "$id" "$url" || { warn "id は $id ですが serviceURL ($url) が既知の Google Chat レシピと一致しないため除外: $d"; continue; }
    [ -f "$d/webview.js" ] || { warn "webview.js がないため除外: $d"; continue; }
    CANDIDATES="${CANDIDATES}${d}
"
    count=$((count + 1))
  done
  if [ "$count" -eq 0 ]; then
    [ -z "$skipped" ] || warn "package.json を解析できなかったフォルダ:$skipped"
    die E_NO_RECIPE "Google Chat レシピが見つかりません。受け付ける組み合わせ: id=hangoutschat + https://chat.google.com、または id=hangouts + https://mail.google.com/chat/ (いずれも webview.js が必要)。$recipes 内のレシピ: $(ls "$recipes" 2>/dev/null | tr '\n' ' ')"
  fi
  if [ "$count" -gt 1 ]; then
    printf '%s' "$CANDIDATES" >&2
    die E_MULTIPLE_RECIPES "対象のレシピが $count 件あり、一意に決められません。自動では選択しません"
  fi
  RECIPE="${CANDIDATES%$'\n'}"
  is_link "$RECIPE" && die E_SYMLINK "シンボリックリンクは対象外です: $RECIPE"
  return 0
}

check_recipe_writable() {
  local probe
  [ -d "$RECIPE" ] || die E_NO_RECIPE "レシピフォルダがありません: $RECIPE"
  [ -w "$RECIPE" ] || die E_NOT_WRITABLE "レシピフォルダに書き込めません: $RECIPE"
  if [ "$DRY" = 0 ]; then
    probe="$(mktemp "$RECIPE/.fs-probe.XXXXXX" 2>/dev/null)" || die E_NOT_WRITABLE "レシピフォルダに書き込めません: $RECIPE"
    rm -f -- "$probe"
  fi
  local k f
  for k in $KEYS; do
    f="$RECIPE/$(fname "$k")"
    if [ -e "$f" ] || [ -L "$f" ]; then
      is_link "$f" && die E_SYMLINK "シンボリックリンクは対象外です: $f"
      [ -f "$f" ] || die E_NOT_REGULAR "通常ファイルではありません: $f"
      [ -w "$f" ] || die E_NOT_WRITABLE "ファイルに書き込めません: $f"
    fi
  done
}

# ---------------------------------------------------------------- payload
prepare_payload() {
  TMPD="$(mktemp -d "${TMPDIR:-/tmp}/fs-slackify.XXXXXX")" || die E_TMP '一時フォルダを作成できません'
  printf '%s' "$PAYLOAD_CSS_B64" | base64 "$b64_flag" | gunzip > "$TMPD/user.css" || die E_PAYLOAD 'CSS ペイロードを展開できません'
  printf '%s' "$PAYLOAD_RT_B64"  | base64 "$b64_flag" | gunzip > "$TMPD/.fs-runtime.cjs" || die E_PAYLOAD 'ランタイムを展開できません'
  printf '%s' "$PAYLOAD_JS_B64"  | base64 "$b64_flag" | gunzip > "$TMPD/user.js" || die E_PAYLOAD 'user.js を展開できません'
  [ "$(sha_of "$TMPD/user.css")" = "$SHA_CSS" ] || die E_PAYLOAD_HASH 'CSS ペイロードの SHA-256 が一致しません'
  [ "$(sha_of "$TMPD/.fs-runtime.cjs")" = "$SHA_RT" ] || die E_PAYLOAD_HASH 'ランタイムの SHA-256 が一致しません'
  [ "$(sha_of "$TMPD/user.js")" = "$SHA_JS" ] || die E_PAYLOAD_HASH 'user.js の SHA-256 が一致しません'
  grep -q "$JS_MARKER" "$TMPD/user.js" || die E_PAYLOAD 'user.js にマーカーがありません'
}

# ---------------------------------------------------------------- css block handling
count_line() { grep -c -x -F -- "$1" "$2" || true; }

# Echoes: none | one | bad
css_block_state() {
  local f="$1" b e bl el
  [ -f "$f" ] || { printf 'none'; return; }
  b="$(count_line "$CSS_BEGIN" "$f")"; e="$(count_line "$CSS_END" "$f")"
  if [ "$b" = 0 ] && [ "$e" = 0 ]; then printf 'none'; return; fi
  if [ "$b" = 1 ] && [ "$e" = 1 ]; then
    bl="$(grep -n -x -F -- "$CSS_BEGIN" "$f" | cut -d: -f1)"; el="$(grep -n -x -F -- "$CSS_END" "$f" | cut -d: -f1)"
    if [ "$bl" -lt "$el" ]; then printf 'one'; return; fi
  fi
  printf 'bad'
}

write_block_file() { # $1 = out
  { printf '%s\n' "$CSS_BEGIN"; printf '/* payload %s (v%s) - generated; edit nothing between the markers */\n' "$PAYLOAD_ID" "$FS_VERSION"; cat "$TMPD/user.css"; printf '%s\n' "$CSS_END"; } > "$1"
}

# compose_css <existing-or-/dev/null> <out>
compose_css() {
  local cur="$1" out="$2" st blockf
  blockf="$TMPD/block.css"; write_block_file "$blockf"
  if [ "$cur" = '/dev/null' ] || [ ! -s "$cur" ]; then cat "$blockf" > "$out"; return; fi
  st="$(css_block_state "$cur")"
  case "$st" in
    one)
      awk -v B="$CSS_BEGIN" -v E="$CSS_END" -v BF="$blockf" '
        BEGIN { inb = 0 }
        inb == 0 && $0 == B { inb = 1; while ((getline l < BF) > 0) print l; close(BF); next }
        inb == 1 { if ($0 == E) inb = 0; next }
        { print }' "$cur" > "$out" ;;
    none)
      { cat "$cur"; if [ -n "$(tail -c1 "$cur")" ]; then printf '\n'; fi; cat "$blockf"; } > "$out" ;;
    *) die E_CSS_MARKERS "user.css の管理マーカーが壊れています ($cur)。BEGIN/END を手動で確認してください" ;;
  esac
}

strip_css_block() { # $1 in, $2 out
  awk -v B="$CSS_BEGIN" -v E="$CSS_END" '
    inb == 0 && $0 == B { inb = 1; next }
    inb == 1 { if ($0 == E) inb = 0; next }
    { print }' "$1" > "$2"
}

# ---------------------------------------------------------------- original user.js compatibility
check_original_js() { # $1 = path to user JS that would be wrapped
  local f="$1"
  grep -q -E 'module\.exports|exports\.' "$f" || die E_ORIG_JS_UNSAFE "既存の user.js が CommonJS 関数のエクスポート形式か確認できません。変更せず中止します"
  if grep -q -E '__filename|module\.filename|require\.main|require\.resolve\(|import\.meta|require\(["'\'']\.{1,2}/user(\.js)?["'\'']\)|["'\'']user\.js["'\'']' "$f"; then
    die E_ORIG_JS_UNSAFE '既存の user.js がファイル名・自己参照に依存しており、コピーして共存させると動作が変わる可能性があります。変更せず中止します'
  fi
}

# ---------------------------------------------------------------- plan / preconditions
# Sets P_* for each key: current sha/existence, and the action. Dies on conflicts.
analyze_install() {
  local k f
  load_ledger_if_any
  for k in $KEYS; do
    f="$RECIPE/$(fname "$k")"
    printf -v "C_$k" '%s' "$(sha_of "$f")"
  done
  if [ "$HAVE_LEDGER" = 1 ]; then
    [ "$L_recipe_dir" = "$RECIPE" ] || die E_STATE "台帳のレシピ ($L_recipe_dir) と検出したレシピ ($RECIPE) が異なります。--uninstall してから再実行してください"
    # Files we manage must be untouched (or absent): never overwrite manual edits.
    [ "$C_rt" = '-' ] || [ "$C_rt" = "$L_post_rt" ] || die E_MODIFIED ".fs-runtime.cjs が管理後に変更されています: $RECIPE/.fs-runtime.cjs"
    if [ "$C_js" != '-' ]; then
      if grep -q "$JS_MARKER" "$RECIPE/user.js"; then
        [ "$C_js" = "$L_post_js" ] || die E_MODIFIED "管理対象の user.js が手動変更されています: $RECIPE/user.js"
        JS_MODE='update'
        [ "$C_orig" = '-' ] || [ "$C_orig" = "$L_post_orig" ] || die E_MODIFIED ".fs-original-user.cjs が変更されています"
      else
        JS_MODE='wrap'      # user (re)created their own user.js
        [ "$C_orig" = '-' ] || [ "$C_orig" = "$L_post_orig" ] || die E_MODIFIED ".fs-original-user.cjs が変更されています"
      fi
    else
      JS_MODE='create'
      [ "$C_orig" = '-' ] || [ "$C_orig" = "$L_post_orig" ] || die E_MODIFIED ".fs-original-user.cjs が変更されています"
    fi
  else
    [ "$C_rt" = '-' ] || die E_UNMANAGED "台帳がないのに .fs-runtime.cjs が存在します: $RECIPE/.fs-runtime.cjs"
    [ "$C_orig" = '-' ] || die E_UNMANAGED "台帳がないのに .fs-original-user.cjs が存在します: $RECIPE/.fs-original-user.cjs"
    if [ "$C_js" != '-' ]; then
      if grep -q "$JS_MARKER" "$RECIPE/user.js"; then die E_UNMANAGED '台帳がないのに管理用の user.js が存在します。手動で確認してください'; fi
      JS_MODE='wrap'
    else
      JS_MODE='create'
    fi
    if [ -f "$RECIPE/user.css" ] && grep -q -F -- "$CSS_BEGIN" "$RECIPE/user.css"; then
      die E_UNMANAGED '台帳がないのに user.css に管理ブロックがあります。マーカー間を手動で削除してから再実行してください'
    fi
  fi
  [ "$JS_MODE" != 'wrap' ] || check_original_js "$RECIPE/user.js"
  if [ -f "$RECIPE/user.css" ]; then
    CSS_STATE="$(css_block_state "$RECIPE/user.css")"
    [ "$CSS_STATE" != 'bad' ] || die E_CSS_MARKERS 'user.css の管理マーカーが壊れています。BEGIN/END を手動で確認してください'
  else
    CSS_STATE='absent'
  fi
}

HAVE_LEDGER=0
load_ledger_if_any() { if have_ledger; then HAVE_LEDGER=1; load_ledger; else HAVE_LEDGER=0; fi; }

up_to_date() { # all managed files already at the payload state?
  [ "$HAVE_LEDGER" = 1 ] || return 1
  [ "$L_payload_id" = "$PAYLOAD_ID" ] || return 1
  [ "$C_rt" = "$SHA_RT" ] && [ "$C_js" = "$SHA_JS" ] || return 1
  [ "$CSS_STATE" = 'one' ] || return 1
  [ "$C_css" = "$L_post_css" ] || return 1
  return 0
}

# ---------------------------------------------------------------- backup
write_manifest_entry() { # $1 manifest $2 key
  local k="$2" f="$RECIPE/$(fname "$2")"
  if [ -f "$f" ]; then
    printf '%s_existed=1\n%s_sha=%s\n%s_mode=%s\n' "$k" "$k" "$(sha_of "$f")" "$k" "$(mode_of "$f")" >> "$1"
  else
    printf '%s_existed=0\n%s_sha=-\n%s_mode=-\n' "$k" "$k" "$k" >> "$1"
  fi
}

make_backup() {
  local id k f
  id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
  CUR_BACKUP="$MANAGE_DIR/backups/$id"
  mkdir -p -- "$MANAGE_DIR/backups" "$MANAGE_DIR/state"; chmod 700 "$MANAGE_DIR" "$MANAGE_DIR/backups" "$MANAGE_DIR/state"
  mkdir -- "$CUR_BACKUP" "$CUR_BACKUP/files" || die E_BACKUP "バックアップフォルダを作成できません: $CUR_BACKUP"
  chmod 700 "$CUR_BACKUP" "$CUR_BACKUP/files"
  {
    printf 'id=%s\ncreated=%s\nstatus=incomplete\nrecipe_dir=%s\nversion=%s\npayload_id=%s\n' "$id" "$(now_iso)" "$RECIPE" "$FS_VERSION" "$PAYLOAD_ID"
    printf 'prev_backup=%s\n' "$( [ "$HAVE_LEDGER" = 1 ] && printf '%s' "$L_last_backup" || printf -- '-')"
    printf 'had_ledger=%s\n' "$HAVE_LEDGER"
  } > "$CUR_BACKUP/manifest"
  for k in $KEYS; do
    f="$RECIPE/$(fname "$k")"
    write_manifest_entry "$CUR_BACKUP/manifest" "$k"
    if [ -f "$f" ]; then
      cp -p -- "$f" "$CUR_BACKUP/files/$(fname "$k")" || die E_BACKUP "バックアップに失敗: $f"
      [ "$(sha_of "$CUR_BACKUP/files/$(fname "$k")")" = "$(sha_of "$f")" ] || die E_BACKUP "バックアップの検証に失敗: $f"
    fi
  done
  if [ "$HAVE_LEDGER" = 1 ]; then cp -p -- "$(ledger_path)" "$CUR_BACKUP/pre_ledger" || die E_BACKUP '台帳のバックアップに失敗'; fi
  sed -i '' 's/^status=incomplete$/status=complete/' "$CUR_BACKUP/manifest"
}

# ---------------------------------------------------------------- restore
# restore_key <backupdir> <key>   (manifest vars loaded with prefix M_)
restore_key() {
  local bdir="$1" k="$2" name target existed sha mode tmp
  name="$(fname "$k")"; target="$RECIPE/$name"
  existed="$(kv_get "M_${k}_existed")"; sha="$(kv_get "M_${k}_sha")"; mode="$(kv_get "M_${k}_mode")"
  if [ "$existed" = 1 ]; then
    tmp="$RECIPE/.fs-tmp.restore.$$.$k"
    cp -p -- "$bdir/files/$name" "$tmp" || return 1
    [ "$(sha_of "$tmp")" = "$sha" ] || { rm -f -- "$tmp"; return 1; }
    chmod "$mode" "$tmp" || true
    mv -f -- "$tmp" "$target" || { rm -f -- "$tmp"; return 1; }
    [ "$(sha_of "$target")" = "$sha" ] || return 1
  else
    rm -f -- "$target" || return 1
  fi
  return 0
}

restore_all_from() { # $1 backupdir ; returns 0 on full success
  local bdir="$1" k rc=0
  kv_load "$bdir/manifest" M_ || return 1
  for k in js css orig rt; do
    restore_key "$bdir" "$k" || { warn "復元に失敗しました: $(fname "$k")"; rc=1; }
  done
  return $rc
}

restore_ledger_from() { # $1 backupdir
  local bdir="$1"
  if [ -f "$bdir/pre_ledger" ]; then
    cp -p -- "$bdir/pre_ledger" "$(ledger_path).tmp.$$" && mv -f -- "$(ledger_path).tmp.$$" "$(ledger_path)"
  else
    rm -f -- "$(ledger_path)"
  fi
}

on_exit() {
  local rc=$?
  set +e
  trap - EXIT
  if [ "$rc" -ne 0 ] && [ "$TXN" = 1 ] && [ -n "$CUR_BACKUP" ]; then
    printf '[fs-slackify] 失敗しました。バックアップから元の状態に戻します...\n' >&2
    if restore_all_from "$CUR_BACKUP"; then
      [ "$LEDGER_TOUCHED" = 0 ] || restore_ledger_from "$CUR_BACKUP"
      sed -i '' 's/^status=complete$/status=failed-restored/' "$CUR_BACKUP/manifest" 2>/dev/null
      printf '[fs-slackify] 元の状態を復元しました (バイト単位で検証済み)。バックアップ: %s\n' "$CUR_BACKUP" >&2
    else
      printf '[fs-slackify] 重大: 自動復元に失敗しました。手動で復元してください: %s/files/ -> %s\n' "$CUR_BACKUP" "$RECIPE" >&2
    fi
  fi
  find_staging_cleanup
  cleanup_tmp
  release_lock
  exit "$rc"
}
find_staging_cleanup() {
  [ -n "$RECIPE" ] && [ -d "$RECIPE" ] || return 0
  local f
  for f in "$RECIPE"/.fs-tmp."$$".* "$RECIPE"/.fs-tmp.restore."$$".*; do
    [ -e "$f" ] && rm -f -- "$f"
  done
  return 0
}
on_signal() { exit 130; }

# ---------------------------------------------------------------- ledger write
write_ledger() {
  local tmp="$(ledger_path).tmp.$$"
  {
    printf 'ledger_version=1\npayload_id=%s\nversion=%s\ninstalled_at=%s\n' "$PAYLOAD_ID" "$FS_VERSION" "$(now_iso)"
    printf 'recipe_dir=%s\nlast_backup=%s\nbaseline=%s\n' "$RECIPE" "$(basename "$CUR_BACKUP")" "$1"
    printf 'post_css=%s\npost_js=%s\npost_rt=%s\npost_orig=%s\n' "$(sha_of "$RECIPE/user.css")" "$(sha_of "$RECIPE/user.js")" "$(sha_of "$RECIPE/.fs-runtime.cjs")" "$(sha_of "$RECIPE/.fs-original-user.cjs")"
  } > "$tmp" || return 1
  LEDGER_TOUCHED=1
  mv -f -- "$tmp" "$(ledger_path)"
}

place() { # <staged> <target> <mode>
  chmod "$3" "$1" && mv -f -- "$1" "$2"
}

install_manage_script() {
  if [ -f "$0" ] && [ -r "$0" ]; then
    cp -- "$0" "$MANAGE_DIR/manage.sh.tmp.$$" && chmod 700 "$MANAGE_DIR/manage.sh.tmp.$$" && mv -f -- "$MANAGE_DIR/manage.sh.tmp.$$" "$MANAGE_DIR/manage.sh" || warn '管理コマンド manage.sh を設置できませんでした'
  else
    warn '管理コマンド manage.sh を設置できませんでした (スクリプトファイルを特定できません)'
  fi
}

# ---------------------------------------------------------------- commands
cmd_install() {
  local baseline js_mode_desc css_desc stage_rt stage_js stage_css stage_orig
  setup_traps
  check_tools
  discover_recipe
  check_recipe_writable
  analyze_install          # read-only pre-flight: conflicts are reported before anything is created
  prepare_payload          # verifies the embedded payload hashes before anything is written

  if [ "$DRY" = 1 ]; then
    case "$CSS_STATE" in
      absent) css_desc='作成' ;; none) css_desc='末尾に管理ブロックを追記' ;; one) css_desc='管理ブロックのみ置換' ;; esac
    case "$JS_MODE" in
      create) js_mode_desc='作成 (既存の user.js なし)' ;;
      wrap) js_mode_desc='既存の user.js を .fs-original-user.cjs に退避し、ラッパーに置換' ;;
      update) js_mode_desc='管理対象ラッパーを更新' ;;
    esac
    say "[dry-run] レシピ: $RECIPE"
    say "[dry-run] user.css: $css_desc"
    say "[dry-run] user.js : $js_mode_desc"
    say '[dry-run] .fs-runtime.cjs: 配置/更新'
    say "[dry-run] バックアップ先: $MANAGE_DIR/backups/<日時>"
    if up_to_date; then say '[dry-run] すでに最新です。何も変更しません。'; fi
    say '[dry-run] 何も書き込みませんでした'
    return 0
  fi

  acquire_lock
  analyze_install          # re-read state while holding the lock
  if up_to_date; then
    info "すでに最新です (payload $PAYLOAD_ID)。変更はありません。"
    return 0
  fi

  # stage next to the targets (same filesystem), verify, then back up and swap in.
  stage_rt="$RECIPE/.fs-tmp.$$.rt"; stage_js="$RECIPE/.fs-tmp.$$.js"; stage_css="$RECIPE/.fs-tmp.$$.css"; stage_orig="$RECIPE/.fs-tmp.$$.orig"
  cp -- "$TMPD/.fs-runtime.cjs" "$stage_rt" || die E_STAGE 'ステージングに失敗'
  cp -- "$TMPD/user.js" "$stage_js" || die E_STAGE 'ステージングに失敗'
  if [ -f "$RECIPE/user.css" ]; then compose_css "$RECIPE/user.css" "$stage_css"; else compose_css /dev/null "$stage_css"; fi
  [ "$(sha_of "$stage_rt")" = "$SHA_RT" ] && [ "$(sha_of "$stage_js")" = "$SHA_JS" ] || die E_STAGE 'ステージング後のハッシュが一致しません'
  grep -q -F -- "$CSS_BEGIN" "$stage_css" && grep -q -F -- "$CSS_END" "$stage_css" || die E_STAGE 'CSS の合成に失敗'
  if [ "$JS_MODE" = 'wrap' ]; then cp -p -- "$RECIPE/user.js" "$stage_orig" || die E_STAGE 'ステージングに失敗'; fi

  make_backup
  load_baseline "$HAVE_LEDGER"
  baseline="$BASELINE_ID"
  TXN=1

  place "$stage_rt" "$RECIPE/.fs-runtime.cjs" 644
  if [ "$JS_MODE" = 'wrap' ]; then place "$stage_orig" "$RECIPE/.fs-original-user.cjs" "$(mode_of "$RECIPE/user.js")"; fi
  place "$stage_css" "$RECIPE/user.css" "$( [ -f "$RECIPE/user.css" ] && mode_of "$RECIPE/user.css" || printf 644)"
  place "$stage_js" "$RECIPE/user.js" 644

  [ "$(sha_of "$RECIPE/.fs-runtime.cjs")" = "$SHA_RT" ] || die E_VERIFY '配置後の検証に失敗 (.fs-runtime.cjs)'
  [ "$(sha_of "$RECIPE/user.js")" = "$SHA_JS" ] || die E_VERIFY '配置後の検証に失敗 (user.js)'
  [ "$(css_block_state "$RECIPE/user.css")" = 'one' ] || die E_VERIFY '配置後の検証に失敗 (user.css)'
  if [ "$JS_MODE" = 'wrap' ]; then
    [ "$(sha_of "$RECIPE/.fs-original-user.cjs")" = "$(kv_get M_js_sha)" ] || die E_VERIFY '配置後の検証に失敗 (.fs-original-user.cjs)'
  fi
  write_ledger "$baseline" || die E_LEDGER '台帳を保存できません'
  TXN=0
  install_manage_script
  info "インストール完了 (payload $PAYLOAD_ID)"
  info "レシピ: $RECIPE"
  info "バックアップ: $CUR_BACKUP"
  info "管理コマンド: bash \"$MANAGE_DIR/manage.sh\" --status | --rollback | --uninstall"
  info 'Ferdium で Google Chat のサービスを再読み込みしてください (サービスを右クリック → Reload Service、または表示メニューから再読み込み)。'
}

BASELINE_ID=''
load_baseline() { # $1 = had ledger
  if [ "$1" = 1 ] && [ -n "$L_baseline" ]; then BASELINE_ID="$L_baseline"; else BASELINE_ID="$(basename "$CUR_BACKUP")"; fi
  # manifest of the pre-install state is needed for the orig-copy verification
  kv_load "$CUR_BACKUP/manifest" M_
}

# ---- shared by rollback / uninstall
require_installed() {
  have_ledger || die E_NOT_INSTALLED 'インストール記録がありません (何も管理していません)'
  load_ledger
  RECIPE="$L_recipe_dir"
  [ -n "$RECIPE" ] && [ -d "$RECIPE" ] || die E_NO_RECIPE "記録されたレシピフォルダがありません: $RECIPE"
  is_link "$RECIPE" && die E_SYMLINK "シンボリックリンクは対象外です: $RECIPE"
  [ -w "$RECIPE" ] || die E_NOT_WRITABLE "レシピフォルダに書き込めません: $RECIPE"
  local id url
  id="$(plutil -extract id raw -o - -- "$RECIPE/package.json" 2>/dev/null || true)"
  url="$(plutil -extract config.serviceURL raw -o - -- "$RECIPE/package.json" 2>/dev/null || true)"
  recipe_pair_ok "$id" "$url" || die E_RECIPE_MISMATCH "記録されたレシピが Google Chat レシピではありません (id=$id)。レシピが入れ替わった可能性があるため変更せず中止します"
}

modified_list() { # echoes keys whose current sha differs from the ledger (and exist)
  local k cur post out=''
  for k in $KEYS; do
    cur="$(sha_of "$RECIPE/$(fname "$k")")"
    post="$(kv_get "L_post_$k")"
    [ "$cur" = "$post" ] || out="$out $k"
  done
  printf '%s' "$out"
}

cmd_rollback() {
  local bdir mod
  setup_traps
  check_tools
  require_installed
  bdir="$MANAGE_DIR/backups/$L_last_backup"
  [ -f "$bdir/manifest" ] || die E_BACKUP "バックアップが見つかりません: $bdir"
  mod="$(modified_list)"
  [ -z "$mod" ] || die E_MODIFIED "管理後に手動変更されたファイルがあるためロールバックを中止します:$mod"
  if [ "$DRY" = 1 ]; then
    say "[dry-run] ロールバック: $bdir の内容へ戻します (レシピ: $RECIPE)"; say '[dry-run] 何も書き込みませんでした'; return 0
  fi
  acquire_lock
  HAVE_LEDGER=1; make_backup   # safety copy of the current state; restored automatically if this fails midway
  TXN=1
  restore_all_from "$bdir" || die E_RESTORE '復元に失敗しました。バックアップは残っています: '"$bdir"
  LEDGER_TOUCHED=1
  restore_ledger_from "$bdir" || die E_LEDGER '台帳を戻せません'
  TXN=0
  sed -i '' 's/^status=complete$/status=rolled-back/' "$bdir/manifest" || true
  info "ロールバック完了: $(basename "$bdir") の状態に戻しました。バックアップは残してあります。"
}

cmd_uninstall() {
  local bdir mod k rc=0 tmp
  setup_traps
  check_tools
  require_installed
  bdir="$MANAGE_DIR/backups/$L_baseline"
  [ -f "$bdir/manifest" ] || die E_BACKUP "元の状態のバックアップが見つかりません: $bdir"
  kv_load "$bdir/manifest" M_
  mod="$(modified_list)"
  # a manually edited user.css can still be cleaned safely by removing only the managed block
  local css_fallback=0 blocking=''
  for k in $mod; do
    if [ "$k" = css ] && [ "$(css_block_state "$RECIPE/user.css")" != 'bad' ]; then css_fallback=1; else blocking="$blocking $k"; fi
  done
  [ -z "$blocking" ] || die E_MODIFIED "管理後に手動変更されたファイルがあるためアンインストールを中止します:$blocking"
  if [ "$DRY" = 1 ]; then
    say "[dry-run] アンインストール: 元の状態 ($L_baseline) を復元します (レシピ: $RECIPE)"
    [ "$css_fallback" = 0 ] || say '[dry-run] user.css は手動変更があるため管理ブロックのみ削除します'
    say '[dry-run] 何も書き込みませんでした'; return 0
  fi
  acquire_lock
  TMPD="$(mktemp -d "${TMPDIR:-/tmp}/fs-slackify.XXXXXX")"
  # keep a safety copy of the current state before touching anything
  HAVE_LEDGER=1; make_backup
  TXN=1
  for k in js orig rt; do restore_key "$bdir" "$k" || rc=1; done
  if [ "$css_fallback" = 1 ]; then
    tmp="$RECIPE/.fs-tmp.$$.css"
    strip_css_block "$RECIPE/user.css" "$tmp" && mv -f -- "$tmp" "$RECIPE/user.css" || rc=1
    warn 'user.css は手動変更があったため、管理ブロックだけを削除しました (元ファイルとのバイト一致は保証されません)'
  else
    restore_key "$bdir" css || rc=1
  fi
  [ "$rc" = 0 ] || die E_RESTORE 'アンインストール中に失敗しました'
  mv -f -- "$(ledger_path)" "$MANAGE_DIR/state/ledger.removed.$(basename "$CUR_BACKUP")"
  TXN=0
  info 'アンインストール完了。元の user.css / user.js を復元しました。バックアップは削除していません:'
  info "  $MANAGE_DIR/backups"
}

cmd_status() {
  local k f cur post stat rc=0
  check_tools
  if ! have_ledger; then
    say '状態: 未インストール (インストール記録なし)'
    if [ -d "$FERDIUM_DIR/recipes" ]; then
      ( discover_recipe >/dev/null 2>&1 && say "検出したレシピ: $RECIPE" ) || say 'レシピ: 一意に検出できません (--dry-run で詳細を確認)'
    fi
    return 3
  fi
  load_ledger
  RECIPE="$L_recipe_dir"
  say "状態: インストール済み (payload $L_payload_id, $L_installed_at)"
  say "レシピ: $RECIPE"
  say "バックアップ: $MANAGE_DIR/backups (最新: $L_last_backup, 元の状態: $L_baseline)"
  for k in $KEYS; do
    f="$RECIPE/$(fname "$k")"; cur="$(sha_of "$f")"; post="$(kv_get "L_post_$k")"
    if [ "$cur" = "$post" ]; then stat='OK'; elif [ "$cur" = '-' ]; then stat='MISSING'; rc=4; else stat='MODIFIED'; rc=4; fi
    printf '  %-24s %s\n' "$(fname "$k")" "$stat"
  done
  if [ -f "$RECIPE/user.css" ]; then say "  user.css 管理ブロック: $(css_block_state "$RECIPE/user.css")"; fi
  if [ "$L_payload_id" != "$PAYLOAD_ID" ]; then say "  このスクリプトの payload は $PAYLOAD_ID です (更新可能: --install)"; fi
  return $rc
}

usage() {
  cat <<'USAGE'
使い方: install.sh [--install | --status | --dry-run | --rollback | --uninstall]
  --install    インストール/更新 (既定)
  --status     現在の状態と改変の有無を表示
  --dry-run    何も書き込まず計画のみ表示 (--rollback / --uninstall と併用可)
  --rollback   直前のインストール/更新を取り消す
  --uninstall  管理対象を削除し、元のファイルを復元する
USAGE
}

main() {
  local a
  for a in "$@"; do
    case "$a" in
      --install) CMD='install' ;;
      --status) CMD='status' ;;
      --rollback) CMD='rollback' ;;
      --uninstall) CMD='uninstall' ;;
      --dry-run) DRY=1 ;;
      -h|--help) usage; exit 0 ;;
      *) usage >&2; exit 2 ;;
    esac
  done
  case "$CMD" in
    install) cmd_install ;;
    status) cmd_status ;;
    rollback) cmd_rollback ;;
    uninstall) cmd_uninstall ;;
  esac
}

main "$@"
