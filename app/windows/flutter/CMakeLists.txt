# This file controls Flutter-level build steps. It should not be edited.
cmake_minimum_required(VERSION 3.14)

set(EPHEMERAL_DIR "${CMAKE_CURRENT_SOURCE_DIR}/ephemeral")

# Configuration provided via flutter tool.
set(GENERATED_CONFIG "${EPHEMERAL_DIR}/generated_config.cmake")

# The Flutter tool normally generates this file. Some build flows (e.g. opening
# the project directly in an IDE) can run CMake before Flutter has created it.
# In that case, generate a minimal fallback so configuration can proceed.
if (NOT EXISTS "${GENERATED_CONFIG}")
  file(MAKE_DIRECTORY "${EPHEMERAL_DIR}")

  # Determine FLUTTER_ROOT.
  set(_flutter_root "")
  if (DEFINED ENV{FLUTTER_ROOT} AND NOT "$ENV{FLUTTER_ROOT}" STREQUAL "")
    set(_flutter_root "$ENV{FLUTTER_ROOT}")
  else()
    find_program(_flutter_cmd NAMES flutter.bat flutter)
    if (_flutter_cmd)
      get_filename_component(_flutter_bin_dir "${_flutter_cmd}" DIRECTORY)
      get_filename_component(_flutter_root "${_flutter_bin_dir}" DIRECTORY)
    endif()
  endif()

  if (_flutter_root STREQUAL "")
    message(FATAL_ERROR
      "Missing ${GENERATED_CONFIG}. Run `flutter pub get`/`flutter build windows`, or set the FLUTTER_ROOT environment variable.")
  endif()

  # Determine PROJECT_DIR (Flutter project root).
  get_filename_component(_project_dir "${CMAKE_CURRENT_SOURCE_DIR}/../.." ABSOLUTE)

  # Normalize paths for the generated config file.
  file(TO_CMAKE_PATH "${_flutter_root}" _flutter_root_cmake)
  file(TO_CMAKE_PATH "${_project_dir}" _project_dir_cmake)
  file(TO_CMAKE_PATH "${EPHEMERAL_DIR}" _ephemeral_dir_cmake)

  # Write a minimal config compatible with the rest of this file.
  set(_generated_config_lines "")
  list(APPEND _generated_config_lines
    "# Auto-generated fallback created by CMake."
    "# The Flutter tool will overwrite this file during a normal Flutter build."
    "set(FLUTTER_ROOT \"${_flutter_root_cmake}\")"
    "set(PROJECT_DIR \"${_project_dir_cmake}\")"
    "set(FLUTTER_EPHEMERAL_DIR \"${_ephemeral_dir_cmake}\")"
    "set(FLUTTER_TARGET \"lib/main.dart\")"
    "set(FLUTTER_TOOL_ENVIRONMENT"
    "  \"FLUTTER_ROOT=${_flutter_root_cmake}\""
    "  \"PROJECT_DIR=${_project_dir_cmake}\""
    "  \"FLUTTER_EPHEMERAL_DIR=${_ephemeral_dir_cmake}\""
    "  \"FLUTTER_TARGET=lib/main.dart\""
    ")"
  )
  string(JOIN "\n" _generated_config_content ${_generated_config_lines})
  file(WRITE "${GENERATED_CONFIG}" "${_generated_config_content}\n")
endif()

include("${GENERATED_CONFIG}")

# TODO: Move the rest of this into files in ephemeral. See
# https://github.com/flutter/flutter/issues/57146.
set(WRAPPER_ROOT "${EPHEMERAL_DIR}/cpp_client_wrapper")

# Set fallback configurations for older versions of the flutter tool.
if (NOT DEFINED FLUTTER_TARGET_PLATFORM)
  set(FLUTTER_TARGET_PLATFORM "windows-x64")
endif()

# === Flutter Library ===
set(FLUTTER_LIBRARY "${EPHEMERAL_DIR}/flutter_windows.dll")

# Published to parent scope for install step.
set(FLUTTER_LIBRARY ${FLUTTER_LIBRARY} PARENT_SCOPE)
set(FLUTTER_ICU_DATA_FILE "${EPHEMERAL_DIR}/icudtl.dat" PARENT_SCOPE)
set(PROJECT_BUILD_DIR "${PROJECT_DIR}/build/" PARENT_SCOPE)
set(AOT_LIBRARY "${PROJECT_DIR}/build/windows/app.so" PARENT_SCOPE)

list(APPEND FLUTTER_LIBRARY_HEADERS
  "flutter_export.h"
  "flutter_windows.h"
  "flutter_messenger.h"
  "flutter_plugin_registrar.h"
  "flutter_texture_registrar.h"
)
list(TRANSFORM FLUTTER_LIBRARY_HEADERS PREPEND "${EPHEMERAL_DIR}/")
add_library(flutter INTERFACE)
target_include_directories(flutter INTERFACE
  "${EPHEMERAL_DIR}"
)
target_link_libraries(flutter INTERFACE "${FLUTTER_LIBRARY}.lib")
add_dependencies(flutter flutter_assemble)

# === Wrapper ===
list(APPEND CPP_WRAPPER_SOURCES_CORE
  "core_implementations.cc"
  "standard_codec.cc"
)
list(TRANSFORM CPP_WRAPPER_SOURCES_CORE PREPEND "${WRAPPER_ROOT}/")
list(APPEND CPP_WRAPPER_SOURCES_PLUGIN
  "plugin_registrar.cc"
)
list(TRANSFORM CPP_WRAPPER_SOURCES_PLUGIN PREPEND "${WRAPPER_ROOT}/")
list(APPEND CPP_WRAPPER_SOURCES_APP
  "flutter_engine.cc"
  "flutter_view_controller.cc"
)
list(TRANSFORM CPP_WRAPPER_SOURCES_APP PREPEND "${WRAPPER_ROOT}/")

# Wrapper sources needed for a plugin.
add_library(flutter_wrapper_plugin STATIC
  ${CPP_WRAPPER_SOURCES_CORE}
  ${CPP_WRAPPER_SOURCES_PLUGIN}
)
apply_standard_settings(flutter_wrapper_plugin)
set_target_properties(flutter_wrapper_plugin PROPERTIES
  POSITION_INDEPENDENT_CODE ON)
set_target_properties(flutter_wrapper_plugin PROPERTIES
  CXX_VISIBILITY_PRESET hidden)
target_link_libraries(flutter_wrapper_plugin PUBLIC flutter)
target_include_directories(flutter_wrapper_plugin PUBLIC
  "${WRAPPER_ROOT}/include"
)
add_dependencies(flutter_wrapper_plugin flutter_assemble)

# Wrapper sources needed for the runner.
add_library(flutter_wrapper_app STATIC
  ${CPP_WRAPPER_SOURCES_CORE}
  ${CPP_WRAPPER_SOURCES_APP}
)
apply_standard_settings(flutter_wrapper_app)
target_link_libraries(flutter_wrapper_app PUBLIC flutter)
target_include_directories(flutter_wrapper_app PUBLIC
  "${WRAPPER_ROOT}/include"
)
add_dependencies(flutter_wrapper_app flutter_assemble)

# === Flutter tool backend ===
# _phony_ is a non-existent file to force this command to run every time,
# since currently there's no way to get a full input/output list from the
# flutter tool.
set(PHONY_OUTPUT "${CMAKE_CURRENT_BINARY_DIR}/_phony_")
set_source_files_properties("${PHONY_OUTPUT}" PROPERTIES SYMBOLIC TRUE)
add_custom_command(
  OUTPUT ${FLUTTER_LIBRARY} ${FLUTTER_LIBRARY_HEADERS}
    ${CPP_WRAPPER_SOURCES_CORE} ${CPP_WRAPPER_SOURCES_PLUGIN}
    ${CPP_WRAPPER_SOURCES_APP}
    ${PHONY_OUTPUT}
  COMMAND ${CMAKE_COMMAND} -E env
    ${FLUTTER_TOOL_ENVIRONMENT}
    "${FLUTTER_ROOT}/packages/flutter_tools/bin/tool_backend.bat"
      ${FLUTTER_TARGET_PLATFORM} $<CONFIG>
  VERBATIM
)
add_custom_target(flutter_assemble DEPENDS
  "${FLUTTER_LIBRARY}"
  ${FLUTTER_LIBRARY_HEADERS}
  ${CPP_WRAPPER_SOURCES_CORE}
  ${CPP_WRAPPER_SOURCES_PLUGIN}
  ${CPP_WRAPPER_SOURCES_APP}
)
