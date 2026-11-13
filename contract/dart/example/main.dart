// 手写（非生成物）：端到端冒烟 —— 证明「生成的客户端 + 真实服务端」能对上。
//
//   dart run example/main.dart                       # 默认 http://127.0.0.1:7877
//   dart run example/main.dart http://127.0.0.1:7878  # 指定别的实例
//
// 传输层用的是裸 dart:io —— fr 里换成 MnWsAppClient 即可（应用前缀与设备令牌
// 都由它负责，生成物不知道 nx-kv 挂在哪）。这段 transport 就是 fr 侧要写的那几行。
import 'dart:convert';
import 'dart:io';

import 'package:nx_kv_client/nx_kv_client.dart';

Future<void> main(List<String> args) async {
  final base = args.isNotEmpty ? args.first : 'http://127.0.0.1:7877';
  final http = HttpClient();

  final api = NxKvClientApi((method, path, query, body) async {
    final uri = Uri.parse('$base$path')
        .replace(queryParameters: query.isEmpty ? null : query);
    final req = await http.openUrl(method, uri);
    if (body != null) {
      req.headers.contentType = ContentType.json;
      req.write(jsonEncode(body));
    }
    final res = await req.close();
    final text = await res.transform(utf8.decoder).join();
    if (res.statusCode >= 400) {
      throw NxKvApiException('HTTP ${res.statusCode}: $text');
    }
    return jsonDecode(text);
  });

  final boot = await api.systemBootstrap();
  print('服务端 nx-kv ${boot.version}（${boot.app.name}）· 命令 ${boot.commands.length} 条');

  final contract = await api.systemContract();
  final same = contract.hash == contractHash;
  print('契约 ${contract.hash} · 生成物 ${contractHash} · 一致：$same');
  if (!same) throw StateError('生成物与服务端契约不一致：重跑 pnpm gen:dart 并重新取依赖');

  final list = await api.localtaskList();
  print('主题 ${list.topics.length} 个 · 等待中 ${list.waiting} 个 · wait 超时 ${list.settings.timeoutSec}s');
  for (final t in list.topics.take(3)) {
    final repo = t.repo == null ? '(无仓库)' : t.repo!.name;
    print('  - ${t.name} [$repo] 待领 ${t.pending} · 进行 ${t.claimed} · 完成 ${t.done}');
  }

  http.close();
}
