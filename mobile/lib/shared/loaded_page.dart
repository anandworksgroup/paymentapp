import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/api/api.dart';
import '../core/auth/auth_controller.dart';
import '../core/cache/cache_store.dart';
import '../theme/kit.dart';
import 'offline.dart';

/// Loads JSON once, shows loading / error / empty states, supports pull-to-refresh, and (when
/// [cacheName] is set) falls back to the last cached copy while offline.
class LoadedPage extends StatefulWidget {
  const LoadedPage({
    super.key,
    required this.title,
    required this.load,
    required this.builder,
    this.subtitle,
    this.actions = const [],
    this.cacheName,
    this.isEmpty,
    this.emptyTitle = 'Nothing here yet',
    this.emptyMessage,
    this.emptyIcon = Icons.inbox_outlined,
    this.footerBuilder,
    this.leading,
    this.bottomInset = 110,
  });

  final String title;
  final String? subtitle;
  final List<Widget> actions;
  final Future<dynamic> Function(Api api) load;
  final List<Widget> Function(BuildContext context, dynamic data, Future<void> Function() reload) builder;
  final String? cacheName;
  final bool Function(dynamic data)? isEmpty;
  final String emptyTitle;
  final String? emptyMessage;
  final IconData emptyIcon;
  final Widget? Function(BuildContext context, dynamic data, Future<void> Function() reload)? footerBuilder;
  final Widget? leading;
  final double bottomInset;

  @override
  State<LoadedPage> createState() => LoadedPageState();
}

class LoadedPageState extends State<LoadedPage> {
  dynamic _data;
  Object? _error;
  bool _loading = true;
  bool _fromCache = false;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    if (widget.cacheName != null) {
      final cached = await context.read<CacheStore>().read(context.read<AuthController>().cacheKey(widget.cacheName!));
      if (cached != null && mounted && _data == null) {
        setState(() {
          _data = cached;
          _fromCache = true;
        });
      }
    }
    await reload();
  }

  Future<void> reload() async {
    if (!mounted) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    final api = context.read<Api>();
    final cache = context.read<CacheStore>();
    final key = widget.cacheName == null ? null : context.read<AuthController>().cacheKey(widget.cacheName!);
    try {
      final data = await widget.load(api);
      if (key != null) await cache.write(key, data);
      if (!mounted) return;
      setState(() {
        _data = data;
        _fromCache = false;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final List<Widget> children;
    if (_data == null && _loading) {
      children = [const LoadingView()];
    } else if (_data == null && _error != null) {
      children = [ErrorView(error: _error!, onRetry: reload)];
    } else if (_data != null && (widget.isEmpty?.call(_data) ?? false)) {
      children = [
        if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 12), child: ErrorView(error: _error!, onRetry: reload)),
        EmptyView(title: widget.emptyTitle, message: widget.emptyMessage, icon: widget.emptyIcon),
      ];
    } else {
      children = [
        if (_fromCache && _error != null) const Padding(padding: EdgeInsets.only(bottom: 12), child: CachedDataNotice()),
        if (!_fromCache && _error != null) Padding(padding: const EdgeInsets.only(bottom: 12), child: ErrorView(error: _error!, onRetry: reload)),
        ...widget.builder(context, _data, reload),
      ];
    }
    return AppPage(
      title: widget.title,
      subtitle: widget.subtitle,
      actions: widget.actions,
      leading: widget.leading,
      onRefresh: reload,
      banner: const OfflineBanner(),
      bottomInset: widget.bottomInset,
      footer: _data == null ? null : widget.footerBuilder?.call(context, _data, reload),
      children: children,
    );
  }
}

/// Cursor-paginated list state for `{object:"list", data, has_more}` endpoints.
class PagedController extends ChangeNotifier {
  PagedController({required this.api, required this.path, this.query = const {}, this.pageSize = 25});

  final Api api;
  final String path;
  Map<String, String?> query;
  final int pageSize;

  final List<Json> items = [];
  bool hasMore = false;
  bool loading = false;
  Object? error;
  bool loadedOnce = false;

  Future<void> refresh() async {
    items.clear();
    hasMore = false;
    loadedOnce = false;
    await _fetch(null);
  }

  Future<void> loadMore() async {
    if (loading || !hasMore || items.isEmpty) return;
    await _fetch(items.last.s('id'));
  }

  Future<void> _fetch(String? after) async {
    loading = true;
    error = null;
    notifyListeners();
    try {
      final res = ApiList.from(await api.get(path, query: {...query, 'limit': '$pageSize', 'starting_after': after}));
      items.addAll(res.data);
      hasMore = res.hasMore;
    } catch (e) {
      error = e;
    }
    loading = false;
    loadedOnce = true;
    notifyListeners();
  }
}

/// Renders a [PagedController]'s items with loading, error, empty and "Load more" states.
class PagedListBody extends StatelessWidget {
  const PagedListBody({super.key, required this.controller, required this.itemBuilder, this.emptyTitle = 'Nothing here yet', this.emptyMessage, this.emptyIcon = Icons.inbox_outlined});

  final PagedController controller;
  final Widget Function(BuildContext, Json item, int index) itemBuilder;
  final String emptyTitle;
  final String? emptyMessage;
  final IconData emptyIcon;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) {
        final c = controller;
        if (!c.loadedOnce && c.loading) return const LoadingView();
        if (c.items.isEmpty && c.error != null) return ErrorView(error: c.error!, onRetry: c.refresh);
        if (c.items.isEmpty) return AppCard(child: EmptyView(title: emptyTitle, message: emptyMessage, icon: emptyIcon));
        return AppCard(
          padding: const EdgeInsets.fromLTRB(16, 6, 16, 6),
          child: Column(children: [
            for (var i = 0; i < c.items.length; i++) ...[
              if (i > 0) const Hairline(),
              itemBuilder(context, c.items[i], i),
            ],
            if (c.error != null) InlineError(c.error),
            if (c.hasMore)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: c.loading
                    ? const LoadingView(compact: true, label: 'Loading more…')
                    : SecondaryButton('Load more', onPressed: c.loadMore, dense: true),
              ),
          ]),
        );
      },
    );
  }
}
