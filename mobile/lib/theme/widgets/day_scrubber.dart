import 'package:flutter/material.dart';

import '../colors.dart';
import '../typography.dart';

/// Horizontal day scrubber in a sage pill track; the selected day is a white knob.
class DayScrubber extends StatefulWidget {
  const DayScrubber({super.key, required this.labels, required this.selectedIndex, required this.onChanged});

  final List<String> labels;
  final int selectedIndex;
  final ValueChanged<int> onChanged;

  @override
  State<DayScrubber> createState() => _DayScrubberState();
}

class _DayScrubberState extends State<DayScrubber> {
  final _controller = ScrollController();
  static const _itemW = 46.0;

  @override
  void didUpdateWidget(covariant DayScrubber oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.selectedIndex != widget.selectedIndex) _reveal();
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _reveal(jump: true));
  }

  void _reveal({bool jump = false}) {
    if (!_controller.hasClients) return;
    final pos = _controller.position;
    final target = (widget.selectedIndex * _itemW - pos.viewportDimension / 2 + _itemW / 2).clamp(0.0, pos.maxScrollExtent);
    if (jump) {
      _controller.jumpTo(target);
    } else {
      _controller.animateTo(target, duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 44,
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(color: AppColors.sage100, borderRadius: BorderRadius.circular(AppRadius.pill)),
      child: ListView.builder(
        controller: _controller,
        scrollDirection: Axis.horizontal,
        itemCount: widget.labels.length,
        itemBuilder: (context, i) {
          final selected = i == widget.selectedIndex;
          return Semantics(
            button: true,
            selected: selected,
            label: widget.labels[i],
            child: GestureDetector(
              onTap: () => widget.onChanged(i),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 180),
                width: _itemW,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: selected ? AppColors.surface : Colors.transparent,
                  borderRadius: BorderRadius.circular(AppRadius.pill),
                  boxShadow: selected ? AppShadows.card : null,
                ),
                child: Text(
                  widget.labels[i],
                  style: AppType.caption(selected ? AppColors.text : AppColors.sage700).copyWith(fontSize: 11.5),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}
